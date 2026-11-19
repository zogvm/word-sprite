/* 词形变化：仅读取 ECDICT 离线生成的逐词精确表，不使用通用规则猜测。 */
window.WordForms = (() => {
    'use strict';

    const EXACT = window.WORD_FORMS_EXACT || {};
    const DERIVED = window.WORD_FORMS_DERIVED || {};
    const LABELS = {
        plural: '复数',
        third: '第三人称单数',
        past: '过去式',
        pp: '过去分词',
        ing: '现在分词',
        comparative: '比较级',
        superlative: '最高级'
    };

    function getRows(word, item) {
        const w = String(word || '').trim();
        if (!w) return [];
        const full = w.toLowerCase();
        const last = full.split(/\s+/).pop();
        const meaning = String((item && item.meaning) || '').split(/[；;，,]/)[0].trim();
        const data = EXACT[full] || EXACT[last];
        const rows = [];

        if (data) {
            Object.keys(LABELS).forEach(key => {
                (data[key] || []).forEach(item => {
                    const value = typeof item === 'string' ? item : item.v;
                    const cn = (typeof item === 'object' && item.cn) ? item.cn : meaning;
                    rows.push({ label: LABELS[key], value, cn });
                });
            });
        }

        (DERIVED[full] || DERIVED[last] || []).forEach(d => {
            rows.push({ label: '人物名词', value: d.value, cn: d.cn || meaning });
        });

        return rows;
    }

    return { getRows };
})();
