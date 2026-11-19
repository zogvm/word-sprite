param(
    [int]$MaxWords = 0,
    [int]$MaxSentences = 0
)
$ErrorActionPreference = 'Stop'

$root = 'c:/pt2/enggame/word-sprite-main'
$audioDir = Join-Path $root 'audio'
$enDir = Join-Path $audioDir 'en'
$sentDir = Join-Path $audioDir 'sentence'
$tmpWav = Join-Path $audioDir '_tts_tmp.wav'
New-Item -ItemType Directory -Force -Path $enDir, $sentDir | Out-Null

$wordsJs = Get-Content (Join-Path $root 'words.js') -Raw -Encoding UTF8
$indexJs = Get-Content (Join-Path $audioDir 'index.js') -Raw -Encoding UTF8

$wordMatches = [regex]::Matches($wordsJs, '\bword\s*:\s*"([^"]+)"')
$exampleMatches = [regex]::Matches($wordsJs, '\bexample\s*:\s*"([^"]+)"')

$uniqueWords = @($wordMatches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
$sentences = @($exampleMatches | ForEach-Object {
    $t = $_.Groups[1].Value -replace '<[^>]+>', ''
    $t = $t -replace '&amp;', '&' -replace '&apos;|&#39;', "'" -replace '&quot;', '"' -replace '&lt;', '<' -replace '&gt;', '>'
    $t = $t -replace '\s+', ' '
    $t.Trim()
} | Where-Object { $_ } | Sort-Object -Unique)

$map = @{}
foreach ($m in [regex]::Matches($indexJs, '"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"')) {
    $map[$m.Groups[1].Value] = $m.Groups[2].Value
}
$lowerKeys = @{}
foreach ($k in $map.Keys) { $lowerKeys[$k.ToLower()] = $true }
$existingStems = @{}
foreach ($v in $map.Values) { $existingStems[$v] = $true }
Get-ChildItem $enDir -File -Filter *.mp3 | ForEach-Object { $existingStems[$_.BaseName] = $true }

function Normalize-Word($s) {
    $t = [string]$s
    $t = $t -replace '[’‘]', "'"
    $t = $t.Trim()
    $t = $t -replace '^[\s"'']+|[\s"'',.!?;:]+$', ''
    return $t
}
function Slug($s) {
    $x = ([string]$s).ToLower() -replace '[^a-z0-9]+', '-' -replace '^-+|-+$', ''
    if (-not $x) { $x = 'word' }
    return $x
}
function Hash-Stem($s) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$s)
    $hex = ([System.BitConverter]::ToString($md5.ComputeHash($bytes)) -replace '-', '').ToLower()
    return $hex.Substring(0, 16)
}

$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
for ($i = 0; $i -lt $voices.Count; $i++) {
    if ($voices.Item($i).GetDescription() -like '*Zira*') { $voice.Voice = $voices.Item($i); break }
}
$voice.Rate = -1

function Synth($text, $outFile) {
    if (Test-Path $outFile) { return }
    $fs = New-Object -ComObject SAPI.SpFileStream
    $fs.Open($tmpWav, 3) | Out-Null
    $voice.AudioOutputStream = $fs
    $voice.Speak([string]$text, 0) | Out-Null
    $fs.Close() | Out-Null
    & ffmpeg -y -loglevel error -i $tmpWav -ac 1 -ar 24000 -codec:a libmp3lame -b:a 32k $outFile
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed: $text" }
}

$missing = @()
foreach ($w in $uniqueWords) {
    $n = Normalize-Word $w
    if (-not $lowerKeys.ContainsKey($n.ToLower())) { $missing += $w }
}
if ($MaxWords -gt 0 -and $missing.Count -gt $MaxWords) { $missing = @($missing | Select-Object -First $MaxWords) }
$i = 0
foreach ($w in $missing) {
    $i++
    $base = Slug $w
    $stem = $base
    $suffix = 2
    while ($existingStems.ContainsKey($stem)) { $stem = "$base-$suffix"; $suffix++ }
    $out = Join-Path $enDir ($stem + '.mp3')
    Synth $w $out
    $map[$w] = $stem
    $lowerKeys[$w.ToLower()] = $true
    $existingStems[$stem] = $true
    if ($i % 50 -eq 0) { Write-Output "words $i/$($missing.Count)" }
}

if ($MaxSentences -gt 0 -and $sentences.Count -gt $MaxSentences) { $sentences = @($sentences | Select-Object -First $MaxSentences) }
$sentMap = @{}
$j = 0
foreach ($s in $sentences) {
    $j++
    $stem = Hash-Stem $s
    $out = Join-Path $sentDir ($stem + '.mp3')
    Synth $s $out
    $sentMap[$s] = $stem
    if ($j % 200 -eq 0) { Write-Output "sentences $j/$($sentences.Count)" }
}

function Json-Str($s) { return ([string]$s).Replace('\', '\\').Replace('"', '\"') }
$wordLines = $map.GetEnumerator() | Sort-Object Key | ForEach-Object { '"' + (Json-Str $_.Key) + '":"' + (Json-Str $_.Value) + '"' }
$wordJson = 'window.KW_AUDIO = {' + ($wordLines -join ',') + '};' + [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $audioDir 'index.js'), $wordJson, (New-Object System.Text.UTF8Encoding($false)))
$sentLines = $sentMap.GetEnumerator() | Sort-Object Key | ForEach-Object { '"' + (Json-Str $_.Key) + '":"' + (Json-Str $_.Value) + '"' }
$sentJson = '// 英文例句录音索引：句子 -> audio/sentence/<hash>.mp3（SAPI Zira 生成）' + [Environment]::NewLine + 'window.KW_SENT_AUDIO = {' + ($sentLines -join ',') + '};' + [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $audioDir 'sentence-index.js'), $sentJson, (New-Object System.Text.UTF8Encoding($false)))
Remove-Item $tmpWav -Force -ErrorAction SilentlyContinue
Write-Output "DONE wordsAdded=$($missing.Count) sentences=$($sentMap.Count)"
