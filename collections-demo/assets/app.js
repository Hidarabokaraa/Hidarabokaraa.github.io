/*
 * FREE LINE Collections — نسخة تجريبية تفاعلية.
 * كل البيانات وهمية وتُحفظ في متصفح الزائر فقط (localStorage). لا خادم ولا قاعدة بيانات.
 * القواعد مطابقة للنظام الحقيقي: لا تحويل عملات، LEVANTIX بالدولار فقط، المبالغ بالسنتات
 * (أعداد صحيحة — لا فاصلة عائمة)، وسلسلة التسليم ← التسوية ← قيد الصندوق بعلاقة 1:1:1.
 */
(function () {
    'use strict';

    const STORE_KEY = 'freeline-demo-v1';

    // ================================================================ أدوات عامة

    const $ = (sel, root = document) => root.querySelector(sel);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** "1,250.5" ← نص من المستخدم إلى سنتات صحيحة، أو null إن لم يكن مبلغاً صالحاً. */
    function parseAmount(raw) {
        const s = String(raw ?? '').replace(/[,\s]/g, '');
        if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) return null;
        const [i, f = ''] = s.split('.');
        return Number(i) * 100 + Number((f + '00').slice(0, 2));
    }

    function fmt(cents) {
        const neg = cents < 0;
        const abs = Math.abs(cents);
        const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const frac = String(abs % 100).padStart(2, '0');
        return (neg ? '-' : '') + int + '.' + frac;
    }

    // عزل اتجاه النص (LRI…PDI) للتواريخ والمبالغ داخل الجمل العربية — يعمل في HTML وفي النص العادي.
    const ltr = (s) => `⁦${s}⁩`;
    const amt = (cents, cur) => ltr(`${fmt(cents)} ${cur}`);

    const money = (cents, cur, tone = '') =>
        `<bdi dir="ltr" class="money ${tone}"><b>${fmt(cents)}</b><small>${esc(cur)}</small></bdi>`;

    const sum = (list, fn) => list.reduce((acc, x) => acc + fn(x), 0);

    // ================================================================ الوقت

    function tzParts(tz, date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }).formatToParts(date);
        const o = {};
        parts.forEach((p) => { o[p.type] = p.value; });
        return o;
    }

    const bizDateIn = (tz, date = new Date()) => { const p = tzParts(tz, date); return `${p.year}-${p.month}-${p.day}`; };
    const timeIn = (tz, date = new Date()) => { const p = tzParts(tz, date); return `${p.hour}:${p.minute}`; };

    function addDays(ymd, n) {
        const [y, m, d] = ymd.split('-').map(Number);
        const t = new Date(Date.UTC(y, m - 1, d + n));
        return t.toISOString().slice(0, 10);
    }

    /** وقت محلي بتوقيت الشركة ← لحظة UTC (بمراعاة فرق التوقيت الفعلي). */
    function zonedToUtc(ymd, hm, tz) {
        const [y, m, d] = ymd.split('-').map(Number);
        const [h, mi] = hm.split(':').map(Number);
        const guess = Date.UTC(y, m - 1, d, h, mi);
        const p = tzParts(tz, new Date(guess));
        const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
        return new Date(guess - (asUtc - guess)).toISOString();
    }

    function fmtDT(iso, tz) {
        const p = tzParts(tz, new Date(iso));
        return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    }

    // ================================================================ الثوابت

    const ROLES = { admin: 'مدير النظام', accounting: 'المحاسبة', collector: 'محصّل' };
    const METHODS = { cash: 'كاش', sham_cash: 'شام كاش', bank_transfer: 'تحويل بنكي', cheque: 'شيك' };
    const TX_CATEGORIES = {
        in: { deposit: 'إيداع', customer: 'تحصيل مباشر', other_in: 'دخل آخر' },
        out: { expense: 'مصاريف تشغيل', bank_fee: 'رسوم بنكية', withdrawal: 'سحب نقدي' },
    };
    const TX_LABELS = { settlement: 'تسليم محصّل', transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', ...TX_CATEGORIES.in, ...TX_CATEGORIES.out };

    // ================================================================ البيانات

    // تُعرَّف أولاً ثم تُحمَّل: seed() تكتب في state أثناء بناء البيانات.
    let state = null;

    function load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                if (s && s.v === 1) return s;
            }
        } catch (e) { /* تخزين غير متاح — نبدأ من بيانات جديدة */ }
        return seed();
    }

    function save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* يعمل في الذاكرة فقط */ }
    }

    function nextId(table) {
        state.seq[table] = (state.seq[table] || 0) + 1;
        return state.seq[table];
    }

    function seed() {
        const s = {
            v: 1,
            seq: {},
            me: null,
            tour: {},
            // مفتوح على الشاشات الواسعة فقط، حتى لا يغطي أزرار الجداول على الأضيق.
            ui: { tourOpen: typeof window !== 'undefined' && window.innerWidth >= 1280 },
            companies: [
                { id: 1, code: 'FREE_LINE', name: 'FREE LINE', tz: 'Asia/Damascus', city: 'دمشق', currencies: ['USD', 'SYP'] },
                { id: 2, code: 'LEVANTIX', name: 'LEVANTIX', tz: 'Asia/Dubai', city: 'دبي', currencies: ['USD'] },
            ],
            cashboxes: [
                { id: 1, company: 1, currency: 'USD', name: 'FREE LINE — USD' },
                { id: 2, company: 1, currency: 'SYP', name: 'FREE LINE — SYP' },
                { id: 3, company: 2, currency: 'USD', name: 'LEVANTIX — USD' },
            ],
            users: [
                { id: 1, name: 'مدير النظام', role: 'admin' },
                { id: 2, name: 'سلمى الحلبي', role: 'accounting' },
                { id: 3, name: 'أحمد العلي', role: 'collector' },
                { id: 4, name: 'خالد منصور', role: 'collector' },
            ],
            customers: [], receivables: [], collections: [], movements: [],
            settlements: [], days: [], txs: [], audit: [],
        };
        state = s;

        const fl = s.companies[0];
        const lv = s.companies[1];
        const todayFL = bizDateIn(fl.tz);
        const todayLV = bizDateIn(lv.tz);
        const yFL = addDays(todayFL, -1);
        const yLV = addDays(todayLV, -1);
        const at = (company, ymd, hm) => zonedToUtc(ymd, hm, company.tz);

        const cust = (company, name, phone, contact) => {
            const c = { id: nextId('customers'), company: company.id, name, phone, contact, active: true, createdAt: at(company, addDays(ymd(company), -20), '10:00') };
            s.customers.push(c);
            return c;
        };
        const ymd = (company) => (company.id === 1 ? todayFL : todayLV);

        const c1 = cust(fl, 'مؤسسة الياسمين للاستيراد', '0944 123 456', 'سامر الخطيب');
        const c2 = cust(fl, 'شركة الساحل للشحن البحري', '0933 882 140', 'رنا ديب');
        const c3 = cust(fl, 'مكتب النخبة للتخليص الجمركي', '0955 310 772', 'وسيم حداد');
        const c4 = cust(lv, 'شركة جسر الخليج التجارية', '+971 50 318 2244', 'فادي نصر');
        const c5 = cust(lv, 'مجموعة الأفق للتجارة العامة', '+971 55 604 1180', 'ليلى عيسى');
        const c6 = cust(fl, 'معمل الشام للألبسة', '0988 045 901', 'مازن قباني');

        const rec = (c, currency, amount, description, ref, dueOffset) => {
            const company = s.companies.find((x) => x.id === c.company);
            const r = {
                id: nextId('receivables'), customer: c.id, company: c.company, currency, amount, description, ref,
                due: addDays(ymd(company), dueOffset), createdAt: at(company, addDays(ymd(company), -12), '09:30'), createdBy: 2,
            };
            s.receivables.push(r);
            return r;
        };

        const r1 = rec(c1, 'USD', 480000, 'أجور شحن حاوية 40 قدم — مرفأ اللاذقية', 'INV-2026-0412', 5);
        const r2 = rec(c1, 'SYP', 3650000000, 'رسوم تخليص جمركي', 'INV-2026-0415', 9);
        const r3 = rec(c2, 'USD', 215000, 'شحن جوي — دفعة أيلول', 'INV-2026-0421', 2);
        rec(c3, 'USD', 120000, 'تخليص وتخزين بضاعة', 'INV-2026-0398', -3);
        const r5 = rec(c4, 'USD', 790000, 'شحن مبرّد — جبل علي', 'LX-2026-118', 7);
        const r6 = rec(c5, 'USD', 325000, 'تخليص جمركي وتوصيل', 'LX-2026-121', 4);
        rec(c6, 'SYP', 1275000000, 'نقل داخلي — حلب إلى دمشق', 'INV-2026-0430', 12);

        // أيام أمس المقفلة — اليوم يفتح بترحيل تلقائي من رصيدها الفعلي.
        const day = (box, date, opening, openedAt) => {
            const d = { id: nextId('days'), cashbox: box, date, opening, status: 'open', openedAt, openedBy: 2 };
            s.days.push(d);
            return d;
        };
        const tx = (d, direction, category, amount, party, atIso, by, source) => {
            const t = { id: nextId('txs'), cashbox: d.cashbox, day: d.id, date: d.date, direction, category, amount, party, at: atIso, by, source: source || null };
            s.txs.push(t);
            return t;
        };

        const d1 = day(1, yFL, 105000, at(fl, yFL, '08:30'));
        const d2 = day(2, yFL, 350000000, at(fl, yFL, '08:31'));
        const d3 = day(3, yLV, 25000, at(lv, yLV, '08:45'));

        // تحصيل كامل الدورة أمس: تحصيل ← تسليم ← تأكيد.
        const fullCycle = (r, collector, amount, hmCollect, hmHand, hmConfirm, d) => {
            const company = s.companies.find((x) => x.id === r.company);
            const k = createCollection(r, collector, amount, 'cash', '', at(company, d.date, hmCollect), true);
            const mv = createHandover(k, collector, amount, at(company, d.date, hmHand), true);
            confirmSettlement(s.settlements.find((x) => x.movement === mv.id), 2, at(company, d.date, hmConfirm), d, true);
        };

        fullCycle(r1, 3, 200000, '11:20', '15:05', '15:40', d1);
        fullCycle(r2, 3, 1500000000, '12:10', '15:10', '15:42', d2);
        fullCycle(r5, 4, 300000, '10:05', '14:20', '14:55', d3);

        tx(d1, 'out', 'expense', 60000, 'قرطاسية وصيانة المكتب', at(fl, yFL, '16:10'), 2);
        tx(d3, 'out', 'bank_fee', 10000, 'رسوم حوالة', at(lv, yLV, '16:30'), 2);

        closeDayRecord(d1, 245000, '', 2, at(fl, yFL, '18:00'));
        closeDayRecord(d2, 1850000000, '', 2, at(fl, yFL, '18:02'));
        closeDayRecord(d3, 315000, '', 2, at(lv, yLV, '18:15'));

        // اليوم: مبلغ ما زال بعهدة أحمد، وتسليم من خالد بانتظار الصندوق.
        const nowFL = timeIn(fl.tz);
        const nowLV = timeIn(lv.tz);
        const earlier = (now, fallback) => (now > fallback ? fallback : '00:05');
        createCollection(r3, 3, 75000, 'cash', 'إيصال 2231', at(fl, todayFL, earlier(nowFL, '09:40')), true);
        const k5 = createCollection(r6, 4, 30000, 'sham_cash', 'SC-88120', at(lv, todayLV, earlier(nowLV, '10:15')), true);
        createHandover(k5, 4, 30000, at(lv, todayLV, earlier(nowLV, '10:50')), true);

        s.audit.sort((a, b) => a.at.localeCompare(b.at));
        s.audit.forEach((a, i) => { a.id = i + 1; });
        s.seq.audit = s.audit.length;
        return s;
    }

    // ================================================================ استعلامات

    const company = (id) => state.companies.find((c) => c.id === id);
    const cashbox = (id) => state.cashboxes.find((b) => b.id === id);
    const user = (id) => state.users.find((u) => u.id === id);
    const customer = (id) => state.customers.find((c) => c.id === id);
    const receivable = (id) => state.receivables.find((r) => r.id === id);
    const collection = (id) => state.collections.find((k) => k.id === id);
    const me = () => user(state.me);
    const boxFor = (companyId, currency) => state.cashboxes.find((b) => b.company === companyId && b.currency === currency);
    const todayFor = (companyId) => bizDateIn(company(companyId).tz);

    const collectedOf = (r) => sum(state.collections.filter((k) => k.receivable === r.id), (k) => k.amount);
    const remainingOf = (r) => r.amount - collectedOf(r);
    const handedOf = (k) => sum(state.movements.filter((m) => m.collection === k.id), (m) => m.amount);
    const custodyOf = (k) => k.amount - handedOf(k);

    function receivableStatus(r) {
        const rem = remainingOf(r);
        if (rem === 0) return { key: 'paid', label: 'مسدّدة', tone: 'positive' };
        const overdue = r.due < todayFor(r.company);
        if (collectedOf(r) > 0) return { key: 'partial', label: overdue ? 'جزئية — متأخرة' : 'مسدّدة جزئياً', tone: overdue ? 'negative' : 'info' };
        return overdue ? { key: 'overdue', label: 'متأخرة', tone: 'negative' } : { key: 'open', label: 'مفتوحة', tone: 'warning' };
    }

    function collectionStage(k) {
        const moves = state.movements.filter((m) => m.collection === k.id);
        const setts = moves.map((m) => state.settlements.find((s) => s.movement === m.id));
        const custody = custodyOf(k);
        const confirmed = setts.length > 0 && setts.every((s) => s.status === 'confirmed');
        const txs = setts.filter((s) => s.tx).map((s) => state.txs.find((t) => t.id === s.tx));
        const closed = txs.length > 0 && custody === 0 && confirmed && txs.every((t) => state.days.find((d) => d.id === t.day).status === 'closed');
        if (custody > 0 && moves.length === 0) return { step: 2, label: 'بعهدة المحصّل', tone: 'warning' };
        if (custody > 0) return { step: 3, label: 'سُلّم جزئياً', tone: 'warning' };
        if (!confirmed) return { step: 4, label: 'بانتظار تأكيد الصندوق', tone: 'info' };
        if (!closed) return { step: 5, label: 'في الصندوق', tone: 'positive' };
        return { step: 6, label: 'مُقفل في يومه', tone: 'positive' };
    }

    const openDay = (boxId) => state.days.find((d) => d.cashbox === boxId && d.status === 'open');
    const lastClosed = (boxId) => state.days.filter((d) => d.cashbox === boxId && d.status === 'closed').sort((a, b) => b.date.localeCompare(a.date))[0];

    function dayTotals(d) {
        const t = state.txs.filter((x) => x.day === d.id);
        const inn = sum(t.filter((x) => x.direction === 'in'), (x) => x.amount);
        const out = sum(t.filter((x) => x.direction === 'out'), (x) => x.amount);
        return { inn, out, expected: d.opening + inn - out, list: t };
    }

    /** مجاميع مفصولة حسب العملة — لا جمع بين USD و SYP أبداً. */
    function byCurrency(list, amountFn, curFn) {
        const out = {};
        list.forEach((x) => { const c = curFn(x); out[c] = (out[c] || 0) + amountFn(x); });
        return out;
    }

    const moneyList = (map, tone = '') => {
        const keys = ['USD', 'SYP'].filter((c) => map[c] !== undefined);
        if (keys.length === 0) return '<span class="muted">—</span>';
        return keys.map((c) => money(map[c], c, tone)).join('<br>');
    };

    // ================================================================ صلاحيات

    function can(ability, subject) {
        const u = me();
        if (!u) return false;
        const r = u.role;
        switch (ability) {
            case 'customers.create':
            case 'receivables.create':
            case 'treasury':
            case 'reports':
                return r === 'admin' || r === 'accounting';
            case 'collect':
                return r === 'admin' || r === 'collector';
            case 'custody':
                return r === 'admin' || r === 'collector';
            case 'handover':
                return r === 'admin' || (r === 'collector' && subject && subject.collector === u.id);
            case 'audit':
                return r === 'admin';
            default:
                return false;
        }
    }

    // ================================================================ العمليات (قواعد العمل)

    class RuleError extends Error {}

    function audit(event, module, summary, atIso, userId) {
        state.audit.push({ id: nextId('audit'), at: atIso || new Date().toISOString(), user: userId ?? state.me, event, module, summary });
    }

    function createCollection(r, collectorId, amount, method, ref, atIso, silent) {
        if (!(amount > 0)) throw new RuleError('المبلغ يجب أن يكون أكبر من صفر.');
        if (amount > remainingOf(r)) throw new RuleError(`لا يمكن أن يتجاوز المبلغ المتبقي على الذمة (${amt(remainingOf(r), r.currency)}).`);
        const c = company(r.company);
        const year = (atIso || new Date().toISOString()).slice(0, 4);
        const k = {
            id: nextId('collections'),
            number: `COL-${year}-${String(nextId('colnum')).padStart(5, '0')}`,
            receivable: r.id, customer: r.customer, company: r.company, currency: r.currency,
            amount, method, ref, receivedAt: atIso || new Date().toISOString(), collector: collectorId,
        };
        state.collections.push(k);
        audit('collection.created', 'التحصيلات', `تسجيل ${ltr(k.number)}: ${amt(amount, r.currency)} من ${customer(r.customer).name}`, k.receivedAt, collectorId);
        if (!silent) state.tour.collect = true;
        void c;
        return k;
    }

    function createHandover(k, byId, amount, atIso, silent) {
        if (!(amount > 0)) throw new RuleError('المبلغ يجب أن يكون أكبر من صفر.');
        if (amount > custodyOf(k)) throw new RuleError(`المتاح بالعهدة ${amt(custodyOf(k), k.currency)} فقط.`);
        const box = boxFor(k.company, k.currency);
        if (!box) throw new RuleError('لا يوجد صندوق بعملة هذا التحصيل لهذه الشركة.');
        const when = atIso || new Date().toISOString();
        const mv = { id: nextId('movements'), collection: k.id, amount, at: when, by: byId, recipient: box.name };
        state.movements.push(mv);
        const st = {
            id: nextId('settlements'), movement: mv.id, collection: k.id, collector: k.collector,
            company: k.company, cashbox: box.id, currency: k.currency, amount,
            status: 'pending', handedAt: when, confirmedAt: null, confirmedBy: null, tx: null,
        };
        state.settlements.push(st);
        audit('handover.created', 'العهدة', `تسليم ${amt(amount, k.currency)} من ${ltr(k.number)} إلى ${ltr(box.name)}`, when, byId);
        if (!silent) state.tour.handover = true;
        return mv;
    }

    function confirmSettlement(st, byId, atIso, forcedDay, silent) {
        if (st.status !== 'pending') throw new RuleError('هذا التسليم مؤكَّد مسبقاً — لا يُسجَّل قيد ثانٍ.');
        const d = forcedDay || openDay(st.cashbox);
        if (!d || (!forcedDay && d.date !== todayFor(st.company))) {
            throw new RuleError('يجب فتح صندوق اليوم قبل تأكيد استلام المبلغ.');
        }
        const when = atIso || new Date().toISOString();
        const k = collection(st.collection);
        const t = {
            id: nextId('txs'), cashbox: st.cashbox, day: d.id, date: d.date, direction: 'in', category: 'settlement',
            amount: st.amount, party: `${user(st.collector).name} — ${ltr(k.number)}`, at: when, by: byId,
            source: { type: 'settlement', id: st.id },
        };
        state.txs.push(t);
        st.status = 'confirmed';
        st.confirmedAt = when;
        st.confirmedBy = byId;
        st.tx = t.id;
        audit('settlement.confirmed', 'الصندوق', `تأكيد استلام ${amt(st.amount, st.currency)} في ${ltr(cashbox(st.cashbox).name)} (قيد #${t.id})`, when, byId);
        if (!silent) state.tour.confirm = true;
        return t;
    }

    function openBoxDay(boxId, manualOpening) {
        const box = cashbox(boxId);
        const today = todayFor(box.company);
        const current = openDay(boxId);
        if (current) throw new RuleError(`يوم ${ltr(current.date)} ما زال مفتوحاً لهذا الصندوق — أقفله أولاً.`);
        if (state.days.some((d) => d.cashbox === boxId && d.date === today)) throw new RuleError('يوم هذا التاريخ مُقفل مسبقاً — لا يُفتح يومان لنفس التاريخ.');
        const prev = lastClosed(boxId);
        let opening;
        if (prev) {
            opening = prev.actual; // ترحيل تلقائي — لا إدخال يدوي بعد أول يوم.
        } else {
            if (manualOpening === null || manualOpening < 0) throw new RuleError('أدخل الرصيد الافتتاحي من عدّ فعلي للنقد (صفر أو أكثر).');
            opening = manualOpening;
        }
        const d = { id: nextId('days'), cashbox: boxId, date: today, opening, status: 'open', openedAt: new Date().toISOString(), openedBy: state.me };
        state.days.push(d);
        audit('day.opened', 'الصندوق', `فتح يوم ${ltr(today)} في ${ltr(box.name)} برصيد افتتاحي ${amt(opening, box.currency)}${prev ? ' (مُرحَّل من ' + prev.date + ')' : ''}`);
        state.tour.open = true;
        return d;
    }

    function closeDayRecord(d, actual, notes, byId, atIso) {
        const { expected } = dayTotals(d);
        const diff = actual - expected;
        if (diff !== 0 && !String(notes || '').trim()) throw new RuleError('يوجد فرق في الصندوق — اكتب سبب الفرق قبل الإقفال.');
        d.status = 'closed';
        d.actual = actual;
        d.expected = expected;
        d.diff = diff;
        d.notes = notes || '';
        d.closedAt = atIso || new Date().toISOString();
        d.closedBy = byId;
        const box = cashbox(d.cashbox);
        audit('day.closed', 'الصندوق', `إقفال يوم ${ltr(d.date)} في ${ltr(box.name)}: الفعلي ${amt(actual, box.currency)}${diff ? '، فرق ' + fmt(diff) : ''}`, d.closedAt, byId);
    }

    function addManualTx(boxId, direction, category, amount, party) {
        const box = cashbox(boxId);
        const d = openDay(boxId);
        if (!d || d.date !== todayFor(box.company)) throw new RuleError('افتح يوم الصندوق أولاً.');
        if (!(amount > 0)) throw new RuleError('المبلغ يجب أن يكون أكبر من صفر.');
        if (!TX_CATEGORIES[direction] || !TX_CATEGORIES[direction][category]) throw new RuleError('اختر فئة صالحة للحركة.');
        const t = { id: nextId('txs'), cashbox: boxId, day: d.id, date: d.date, direction, category, amount, party: party || '', at: new Date().toISOString(), by: state.me, source: null };
        state.txs.push(t);
        audit('transaction.created', 'الصندوق', `${direction === 'in' ? 'حركة واردة' : 'حركة صادرة'} ${amt(amount, box.currency)} — ${TX_LABELS[category]}`);
    }

    function transfer(fromId, toId, amount) {
        const from = cashbox(fromId);
        const to = cashbox(toId);
        if (!from || !to || fromId === toId) throw new RuleError('اختر صندوقين مختلفين.');
        if (from.currency !== to.currency) throw new RuleError('التحويل مسموح فقط بين صندوقين بنفس العملة — لا يوجد تحويل عملات في النظام.');
        if (!(amount > 0)) throw new RuleError('المبلغ يجب أن يكون أكبر من صفر.');
        const dFrom = openDay(fromId);
        const dTo = openDay(toId);
        if (!dFrom || dFrom.date !== todayFor(from.company)) throw new RuleError(`افتح يوم ${ltr(from.name)} أولاً.`);
        if (!dTo || dTo.date !== todayFor(to.company)) throw new RuleError(`افتح يوم ${ltr(to.name)} أولاً.`);
        if (amount > dayTotals(dFrom).expected) throw new RuleError(`الرصيد المتوقع في ${ltr(from.name)} لا يكفي.`);
        const now = new Date().toISOString();
        const tOut = { id: nextId('txs'), cashbox: fromId, day: dFrom.id, date: dFrom.date, direction: 'out', category: 'transfer_out', amount, party: `إلى ${ltr(to.name)}`, at: now, by: state.me, source: null };
        const tIn = { id: nextId('txs'), cashbox: toId, day: dTo.id, date: dTo.date, direction: 'in', category: 'transfer_in', amount, party: `من ${ltr(from.name)}`, at: now, by: state.me, source: null };
        state.txs.push(tOut, tIn);
        audit('transfer.created', 'الصندوق', `تحويل ${amt(amount, from.currency)} من ${ltr(from.name)} إلى ${ltr(to.name)}`);
    }

    // ================================================================ أيقونات

    const ICONS = {
        dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .67V2l-1 .67L16 2l-3 2-3-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
        cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
        wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M17 12h4v4h-4a2 2 0 0 1 0-4z"/>',
        vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M12 17v-1.5M15.5 12H17M7 12h1.5M7 20v1M17 20v1"/>',
        chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
        alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
        menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
        lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
        swap: '<path d="M17 3l4 4-4 4M21 7H8M7 21l-4-4 4-4M3 17h13"/>',
        reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    };
    const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

    // ================================================================ التوجيه

    function route() {
        const hash = location.hash.replace(/^#/, '') || '/';
        const [path, query = ''] = hash.split('?');
        const params = Object.fromEntries(new URLSearchParams(query));
        const parts = path.split('/').filter(Boolean);
        return { parts, params, path };
    }

    const go = (hash) => { location.hash = hash; };

    const NAV = [
        { group: 'العمل اليومي' },
        { href: '#/dashboard', key: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
        { href: '#/customers', key: 'customers', label: 'العملاء', icon: 'users' },
        { href: '#/receivables', key: 'receivables', label: 'الذمم المطلوب تحصيلها', icon: 'receipt' },
        { href: '#/collections', key: 'collections', label: 'التحصيلات', icon: 'cash' },
        { href: '#/custody', key: 'custody', label: 'المبالغ بعهدتي', icon: 'wallet', ability: 'custody', count: () => state.collections.filter((k) => custodyOf(k) > 0 && (me().role === 'admin' || k.collector === state.me)).length },
        { group: 'الخزينة', ability: 'treasury' },
        { href: '#/treasury', key: 'treasury', label: 'الصندوق اليومي', icon: 'vault', ability: 'treasury', count: () => state.settlements.filter((s) => s.status === 'pending').length },
        { href: '#/reports', key: 'reports', label: 'التقارير', icon: 'chart', ability: 'reports' },
        { group: 'الإدارة', ability: 'audit' },
        { href: '#/audit', key: 'audit', label: 'سجل النشاط', icon: 'shield', ability: 'audit' },
    ];

    // ================================================================ الهيكل

    function layout(title, body, activeKey) {
        const u = me();
        const nav = NAV.filter((n) => !n.ability || can(n.ability)).map((n) => {
            if (n.group) return `<div class="nav-group">${n.group}</div>`;
            const c = n.count ? n.count() : 0;
            return `<a href="${n.href}" ${n.key === activeKey ? 'aria-current="page"' : ''}>${icon(n.icon)}<span>${n.label}</span>${c ? `<span class="count">${c}</span>` : ''}</a>`;
        }).join('');

        const clocks = state.companies.map((c) => `<span>${c.city} <bdi dir="ltr">${timeIn(c.tz)}</bdi></span>`).join('');

        return `
        <div class="shell" id="shell">
            <aside class="side" aria-label="القائمة الرئيسية">
                <div class="side-brand">
                    <img class="logo" src="assets/free-line-mark.webp" alt="" width="42" height="42">
                    <div><b>FREE LINE</b><small>COLLECTIONS</small></div>
                </div>
                <nav class="nav">${nav}</nav>
                <div class="side-user">
                    <div class="who">
                        <span class="avatar">${esc(u.name.slice(0, 1))}</span>
                        <div><b>${esc(u.name)}</b><small>${ROLES[u.role]}</small></div>
                    </div>
                    <label class="sr-only" for="switch-user">تبديل المستخدم</label>
                    <select id="switch-user" data-change="switch-user">
                        ${state.users.map((x) => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>جرّب بدور: ${esc(x.name)} (${ROLES[x.role]})</option>`).join('')}
                    </select>
                    <button type="button" data-action="reset">إعادة البيانات التجريبية</button>
                </div>
            </aside>
            <div class="main">
                <header class="top">
                    <button class="menu-btn" type="button" data-action="menu" aria-label="فتح القائمة">${icon('menu')}</button>
                    <span class="crumb">${esc(title)}</span>
                    <span class="demo-pill">نسخة تجريبية</span>
                    <span class="clock" aria-label="توقيت الشركات">${clocks}</span>
                </header>
                <main class="content">${body}</main>
            </div>
        </div>
        ${tourPanel()}`;
    }

    function pageHead(iconName, title, desc, actions = '') {
        return `<div class="page-head">
            <span class="tile">${icon(iconName)}</span>
            <div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div>
            ${actions ? `<div class="actions">${actions}</div>` : ''}
        </div>`;
    }

    const card = (title, body, opts = {}) => `<section class="card ${opts.cls || ''}">
        ${title ? `<div class="card-head"><h2>${title}</h2>${opts.end ? `<div class="end">${opts.end}</div>` : ''}${opts.desc ? `<p>${opts.desc}</p>` : ''}</div>` : ''}
        ${opts.flush ? body : `<div class="card-body">${body}</div>`}
    </section>`;

    const table = (head, rows, emptyTitle, emptyText) => rows.length
        ? `<div class="table-wrap"><table class="table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : `<div class="empty"><b>${emptyTitle}</b>${emptyText || ''}</div>`;

    const companyBadge = (id) => `<span class="badge company">${esc(company(id).name)}</span>`;

    function forbidden(what) {
        return card('', `<div class="empty">
            <b>${icon('lock').replace('<svg', '<svg style="width:28px;height:28px;margin:0 auto 8px;display:block"')}هذه الشاشة ليست ضمن صلاحيات ${ROLES[me().role]}</b>
            ${what}<br><br>
            <span class="small">بدّل الدور من أسفل القائمة الجانبية لترى كيف تختلف الصلاحيات.</span>
        </div>`);
    }

    // ================================================================ دليل التجربة

    const TOUR = [
        { key: 'collect', text: 'سجّل تحصيلاً على ذمة مفتوحة', hint: 'بدور محصّل: الذمم ← تحصيل' },
        { key: 'handover', text: 'سلّم المبلغ من عهدتك إلى الصندوق', hint: 'من صفحة التحصيل نفسها' },
        { key: 'open', text: 'افتح يوم الصندوق', hint: 'بدور المحاسبة — الرصيد يُرحَّل تلقائياً من أمس' },
        { key: 'confirm', text: 'أكّد استلام التسليم في الصندوق', hint: 'الخزينة ← تسليمات المحصّلين' },
        { key: 'close', text: 'أقفل اليوم بالرصيد الفعلي', hint: 'جرّب إدخال رقم مختلف عن المتوقع' },
    ];

    function tourPanel() {
        const done = TOUR.filter((t) => state.tour[t.key]).length;
        return `<details class="tour" ${state.ui.tourOpen ? 'open' : ''} data-toggle="tour">
            <summary>جرّب دورة المبلغ كاملة <span class="bar" aria-hidden="true"><i style="width:${(done / TOUR.length) * 100}%"></i></span><span class="small muted">${done}/${TOUR.length}</span></summary>
            <ol>${TOUR.map((t) => `<li class="${state.tour[t.key] ? 'ok' : ''}"><div><span>${t.text}</span><small>${t.hint}</small></div></li>`).join('')}</ol>
        </details>`;
    }

    // ================================================================ الشاشات

    function viewEntry() {
        const steps = [
            ['الذمة', 'مبلغ مستحق على عميل، بعملته'],
            ['التحصيل', 'المحصّل يستلم المبلغ ويسجّله'],
            ['العهدة', 'المبلغ بحوزة المحصّل باسمه'],
            ['التسليم', 'يسلّمه لصندوق الشركة بنفس العملة'],
            ['تأكيد الصندوق', 'المحاسبة تؤكد، فيُسجَّل قيد واحد فقط'],
            ['إقفال اليوم', 'مطابقة الرصيد الفعلي وترحيله لليوم التالي'],
        ];
        const roles = [
            { id: 1, ic: 'shield', title: 'مدير النظام', text: 'يرى كل شيء: التحصيل والعهدة والصندوق والتقارير وسجل النشاط.' },
            { id: 2, ic: 'vault', title: 'سلمى — المحاسبة', text: 'العملاء والذمم، فتح يوم الصندوق، تأكيد التسليمات، الإقفال والتقارير.' },
            { id: 3, ic: 'wallet', title: 'أحمد — محصّل', text: 'يسجّل ما يستلمه من العملاء، ويسلّم عهدته للصندوق.' },
        ];
        return `<div class="entry">
            <section class="entry-brand">
                <div class="stack" style="gap:22px">
                    <div class="mark-wrap"><img src="assets/free-line-mark.webp" alt="شعار FREE LINE" width="88" height="88"></div>
                    <div>
                        <h1>كل دولار وكل ليرة، من العميل حتى إقفال الصندوق</h1>
                        <p class="lede">نظام FREE LINE لإدارة الذمم والتحصيلات وعهدة المحصّلين والصندوق اليومي، لشركتي FREE LINE و LEVANTIX.</p>
                    </div>
                </div>
                <ol class="journey" aria-label="مسار المبلغ في النظام">
                    ${steps.map(([b, s], i) => `<li style="--i:${i}"><span class="dot">${i + 1}</span><div><b>${b}</b><span>${s}</span></div></li>`).join('')}
                </ol>
                <p class="foot">FREE LINE — Shipping &amp; Customs Clearance</p>
            </section>
            <section class="entry-main">
                <div>
                    <h2>جرّب النظام دون تسجيل دخول</h2>
                    <p class="sub">اختر الدور الذي تريد أن تبدأ به. يمكنك التبديل بين الأدوار في أي وقت.</p>
                </div>
                <div class="roles">
                    ${roles.map((r) => `<button type="button" class="role" data-action="enter" data-user="${r.id}">
                        <span class="ico">${icon(r.ic)}</span>
                        <span><b>${r.title}</b><small>${r.text}</small></span>
                        <span class="go">ابدأ</span>
                    </button>`).join('')}
                </div>
                <p class="note">${icon('info').replace('<svg', '<svg style="width:18px;height:18px;flex:none;margin-top:2px"')}
                    <span>كل البيانات هنا وهمية وتُحفظ في متصفحك فقط، لا يراها أحد غيرك ولا تصل إلى أي خادم. النظام الحقيقي محمي بتسجيل دخول وصلاحيات لكل مستخدم.</span>
                </p>
            </section>
        </div>`;
    }

    function viewDashboard() {
        const u = me();
        const openRecs = state.receivables.filter((r) => remainingOf(r) > 0);
        const outstanding = byCurrency(openRecs, remainingOf, (r) => r.currency);
        const todayCols = state.collections.filter((k) => bizDateIn(company(k.company).tz, new Date(k.receivedAt)) === todayFor(k.company));
        const collectedToday = byCurrency(todayCols, (k) => k.amount, (k) => k.currency);
        const inCustody = byCurrency(state.collections.filter((k) => custodyOf(k) > 0), custodyOf, (k) => k.currency);
        const pending = state.settlements.filter((s) => s.status === 'pending');
        const overdue = openRecs.filter((r) => r.due < todayFor(r.company)).length;

        const latest = [...state.collections].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        const featured = latest.find((k) => collectionStage(k).step < 6) || latest[0];

        const actions = [
            can('collect') ? `<a class="btn btn-primary" href="#/receivables">${icon('cash')}تسجيل تحصيل</a>` : '',
            can('treasury') ? `<a class="btn btn-secondary" href="#/treasury">${icon('vault')}الصندوق اليومي</a>` : '',
        ].join('');

        const boxes = state.cashboxes.map((b) => {
            const d = openDay(b.id);
            const today = todayFor(b.company);
            const closedToday = state.days.find((x) => x.cashbox === b.id && x.date === today && x.status === 'closed');
            let status;
            let bal;
            if (d && d.date === today) { status = '<span class="badge positive">مفتوح</span>'; bal = dayTotals(d).expected; } else if (closedToday) { status = '<span class="badge neutral">مُقفل اليوم</span>'; bal = closedToday.actual; } else { const p = lastClosed(b.id); status = '<span class="badge warning">لم يُفتح بعد</span>'; bal = p ? p.actual : 0; }
            return `<tr><td><b>${esc(b.name)}</b><span class="sub">${esc(company(b.company).city)}، يوم ${ltr(today)}</span></td><td>${status}</td><td class="num">${money(bal, b.currency)}</td></tr>`;
        });

        return pageHead('dashboard', `مرحباً، ${esc(u.name)}`, 'ملخص حركة التحصيلات والعهدة والصندوق — كل عملة على حدة.', actions) + `
        <div class="grid cols-4">
            <section class="card stat accent"><span class="label">المتبقي على العملاء</span><span class="value">${moneyList(outstanding)}</span><span class="hint">${openRecs.length} ذمة مفتوحة${overdue ? `، منها ${overdue} متأخرة` : ''}</span></section>
            <section class="card stat"><span class="label">تحصيل اليوم</span><span class="value">${moneyList(collectedToday, 'pos')}</span><span class="hint">${todayCols.length} عملية تحصيل</span></section>
            <section class="card stat"><span class="label">بعهدة المحصّلين الآن</span><span class="value">${moneyList(inCustody, 'gold')}</span><span class="hint">مبالغ لم تُسلَّم للصندوق بعد</span></section>
            <section class="card stat"><span class="label">تسليمات بانتظار الصندوق</span><span class="value">${moneyList(byCurrency(pending, (s) => s.amount, (s) => s.currency))}</span><span class="hint">${pending.length} تسليم ينتظر التأكيد</span></section>
        </div>
        ${featured ? card(`أين وصل المبلغ ${esc(featured.number)}؟`, trail(featured), { flush: true, end: `<a class="btn btn-secondary btn-sm" href="#/collections/${featured.id}">فتح التحصيل</a>`, desc: `${esc(customer(featured.customer).name)}، ${amt(featured.amount, featured.currency)}` }) : ''}
        <div class="grid cols-2">
            ${card('آخر التحصيلات', table('<th>التحصيل</th><th>المحصّل</th><th class="num">المبلغ</th><th>المرحلة</th>', latest.slice(0, 6).map((k) => {
                const st = collectionStage(k);
                return `<tr><td><a href="#/collections/${k.id}"><bdi dir="ltr">${k.number}</bdi></a><span class="sub">${esc(customer(k.customer).name)}</span></td><td>${esc(user(k.collector).name)}</td><td class="num">${money(k.amount, k.currency)}</td><td><span class="badge ${st.tone}">${st.label}</span></td></tr>`;
            }), 'لا توجد تحصيلات بعد'), { flush: true })}
            ${card('الصناديق اليوم', table('<th>الصندوق</th><th>الحالة</th><th class="num">الرصيد</th>', boxes, ''), { flush: true, desc: 'ثلاثة صناديق، كل صندوق بعملة واحدة ولا تُجمع أرصدتها.' })}
        </div>`;
    }

    /** مسار المبلغ — يجيب عن سؤال «أين هذا المبلغ الآن؟». */
    function trail(k) {
        const st = collectionStage(k);
        const r = receivable(k.receivable);
        const c = company(k.company);
        const setts = state.settlements.filter((s) => s.collection === k.id);
        const lastSett = setts[setts.length - 1];
        const tx = lastSett && lastSett.tx ? state.txs.find((t) => t.id === lastSett.tx) : null;
        const d = tx ? state.days.find((x) => x.id === tx.day) : null;
        const steps = [
            ['الذمة', esc(r.ref)],
            ['التحصيل', `<bdi dir="ltr">${fmtDT(k.receivedAt, c.tz)}</bdi>`],
            ['العهدة', esc(user(k.collector).name)],
            ['التسليم', lastSett ? `<bdi dir="ltr">${fmtDT(lastSett.handedAt, c.tz)}</bdi>` : 'لم يُسلَّم بعد'],
            ['تأكيد الصندوق', tx ? `قيد <bdi dir="ltr">#${tx.id}</bdi>` : esc(boxFor(k.company, k.currency).name)],
            ['إقفال اليوم', d && d.status === 'closed' ? `يوم <bdi dir="ltr">${d.date}</bdi>` : (d ? 'اليوم ما زال مفتوحاً' : '—')],
        ];
        // st.step = عدد المراحل المكتملة؛ المرحلة التالية هي «هنا الآن».
        return `<div class="trail" role="list">${steps.map(([b, s], i) => {
            const cls = i < st.step ? 'done' : (i === st.step ? 'here' : '');
            const label = i < st.step ? '✓' : String(i + 1);
            return `<div class="step ${cls}" role="listitem" ${i === st.step ? 'aria-current="step"' : ''}><span class="pin">${label}</span><b>${b}</b><span>${s}</span></div>`;
        }).join('')}</div>`;
    }

    function viewCustomers(params) {
        const q = (params.q || '').trim();
        const co = params.company || '';
        const list = state.customers.filter((c) => (!co || String(c.company) === co) && (!q || c.name.includes(q) || c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))));
        const rows = list.map((c) => {
            const recs = state.receivables.filter((r) => r.customer === c.id);
            const rem = byCurrency(recs.filter((r) => remainingOf(r) > 0), remainingOf, (r) => r.currency);
            return `<tr><td><a href="#/customers/${c.id}"><b>${esc(c.name)}</b></a><span class="sub">${esc(c.contact || '')}</span></td><td>${companyBadge(c.company)}</td><td><bdi dir="ltr">${esc(c.phone)}</bdi></td><td>${recs.length}</td><td class="num">${moneyList(rem)}</td><td><a class="btn btn-secondary btn-sm" href="#/customers/${c.id}">عرض</a></td></tr>`;
        });
        const form = can('customers.create') ? `<details class="card" ${params.new ? 'open' : ''}>
            <summary class="card-head" style="cursor:pointer"><h2>إضافة عميل</h2><p>الشركة تحدد العملات المسموحة: FREE LINE بالدولار والليرة، LEVANTIX بالدولار فقط.</p></summary>
            <div class="card-body"><form class="form" data-form="customer" novalidate>
                ${selectField('company', 'الشركة', state.companies.map((x) => [x.id, x.name]), true)}
                ${inputField('name', 'اسم العميل', { required: true, placeholder: 'مثال: شركة الأمل للتجارة' })}
                ${inputField('phone', 'رقم الهاتف', { required: true, placeholder: '09XXXXXXXX', ltr: true })}
                ${inputField('contact', 'الشخص المسؤول')}
                <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check')}حفظ العميل</button></div>
            </form></div>
        </details>` : '';
        return pageHead('users', 'العملاء', 'بيانات العملاء وأرصدتهم المتبقية — مفصولة حسب العملة.') + form + `
        <section class="card">
            <div class="filters">
                <label class="sr-only" for="f-q">بحث</label>
                <input class="input" id="f-q" type="search" placeholder="ابحث باسم العميل أو رقم الهاتف" value="${esc(q)}" data-filter="q">
                <label class="sr-only" for="f-co">الشركة</label>
                <select class="input" id="f-co" data-filter="company"><option value="">كل الشركات</option>${state.companies.map((x) => `<option value="${x.id}" ${co === String(x.id) ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
            </div>
            ${table('<th>العميل</th><th>الشركة</th><th>الهاتف</th><th>الذمم</th><th class="num">المتبقي</th><th></th>', rows, q || co ? 'لا يوجد عملاء مطابقون' : 'لا يوجد عملاء بعد', q || co ? 'جرّب تعديل البحث أو الشركة.' : '')}
        </section>`;
    }

    function viewCustomer(id) {
        const c = customer(id);
        if (!c) return notFound();
        const co = company(c.company);
        const recs = state.receivables.filter((r) => r.customer === c.id);
        const cols = state.collections.filter((k) => k.customer === c.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        const recRows = recs.map((r) => receivableRow(r, false));
        const form = can('receivables.create') ? card('إضافة ذمة مالية', `<form class="form" data-form="receivable" data-customer="${c.id}" novalidate>
            ${inputField('description', 'وصف الذمة', { required: true, placeholder: 'مثال: أجور شحن وتخليص' })}
            ${inputField('ref', 'رقم الفاتورة / المرجع', { placeholder: 'INV-2026-001', ltr: true })}
            ${inputField('amount', 'المبلغ', { required: true, placeholder: '0.00', ltr: true, inputmode: 'decimal' })}
            ${selectField('currency', 'العملة', co.currencies.map((x) => [x, x === 'USD' ? 'USD — دولار' : 'SYP — ليرة سورية']), true, co.currencies.length === 1 ? 'LEVANTIX تتعامل بالدولار فقط.' : 'لا تحويل بين العملات — كل ذمة بعملة واحدة.')}
            ${inputField('due', 'تاريخ الاستحقاق', { type: 'date', ltr: true, value: addDays(todayFor(c.company), 14) })}
            <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('plus')}حفظ الذمة</button></div>
        </form>`, { desc: 'مبلغ مطلوب تحصيله من العميل.' }) : '';

        return pageHead('users', esc(c.name), `${companyBadge(c.company)} <bdi dir="ltr">${esc(c.phone)}</bdi>${c.contact ? '، المسؤول: ' + esc(c.contact) : ''}`, `<a class="btn btn-secondary" href="#/customers">كل العملاء</a>`) + `
        <div class="grid cols-3">
            <section class="card stat accent"><span class="label">إجمالي الذمم</span><span class="value">${moneyList(byCurrency(recs, (r) => r.amount, (r) => r.currency))}</span></section>
            <section class="card stat"><span class="label">المُحصَّل</span><span class="value">${moneyList(byCurrency(cols, (k) => k.amount, (k) => k.currency), 'pos')}</span></section>
            <section class="card stat"><span class="label">المتبقي</span><span class="value">${moneyList(byCurrency(recs.filter((r) => remainingOf(r) > 0), remainingOf, (r) => r.currency), 'neg')}</span></section>
        </div>
        ${card('الذمم', table('<th>الوصف</th><th class="num">الأصل</th><th class="num">المتبقي</th><th>الاستحقاق</th><th>الحالة</th><th></th>', recRows, 'لا توجد ذمم لهذا العميل', can('receivables.create') ? 'أضف أول ذمة من النموذج أدناه.' : ''), { flush: true })}
        ${form}
        ${card('التحصيلات من هذا العميل', table('<th>رقم التحصيل</th><th>التاريخ</th><th>المحصّل</th><th class="num">المبلغ</th><th>المرحلة</th>', cols.map((k) => {
            const st = collectionStage(k);
            return `<tr><td><a href="#/collections/${k.id}"><bdi dir="ltr">${k.number}</bdi></a></td><td><bdi dir="ltr">${fmtDT(k.receivedAt, co.tz)}</bdi></td><td>${esc(user(k.collector).name)}</td><td class="num">${money(k.amount, k.currency)}</td><td><span class="badge ${st.tone}">${st.label}</span></td></tr>`;
        }), 'لا توجد تحصيلات بعد'), { flush: true })}`;
    }

    function receivableRow(r, withCustomer) {
        const st = receivableStatus(r);
        const rem = remainingOf(r);
        const collect = can('collect') && rem > 0 ? `<a class="btn btn-primary btn-sm" href="#/receivables/${r.id}/collect">${icon('cash')}تحصيل</a>` : '';
        return `<tr>
            ${withCustomer ? `<td><a href="#/customers/${r.customer}"><b>${esc(customer(r.customer).name)}</b></a><span class="sub">${companyBadge(r.company)}</span></td>` : ''}
            <td>${esc(r.description)}<span class="sub"><bdi dir="ltr">${esc(r.ref || '—')}</bdi></span></td>
            <td class="num">${money(r.amount, r.currency)}</td>
            <td class="num">${money(rem, r.currency, rem > 0 ? 'neg' : 'pos')}</td>
            <td><bdi dir="ltr">${r.due}</bdi></td>
            <td><span class="badge ${st.tone}">${st.label}</span></td>
            <td>${collect}</td>
        </tr>`;
    }

    function viewReceivables(params) {
        const q = (params.q || '').trim();
        const co = params.company || '';
        const cur = params.currency || '';
        const stf = params.status || 'unpaid';
        const list = state.receivables.filter((r) => {
            const st = receivableStatus(r).key;
            if (co && String(r.company) !== co) return false;
            if (cur && r.currency !== cur) return false;
            if (stf === 'unpaid' && st === 'paid') return false;
            if (stf === 'overdue' && !(r.due < todayFor(r.company) && st !== 'paid')) return false;
            if (stf === 'paid' && st !== 'paid') return false;
            if (q && !(customer(r.customer).name.includes(q) || (r.ref || '').toLowerCase().includes(q.toLowerCase()) || r.description.includes(q))) return false;
            return true;
        }).sort((a, b) => a.due.localeCompare(b.due));
        const totals = byCurrency(list, remainingOf, (r) => r.currency);
        return pageHead('receivables', 'الذمم المطلوب تحصيلها', 'مرتّبة حسب تاريخ الاستحقاق. المتأخرة تظهر أولاً.') + `
        <div class="grid cols-2">
            ${['USD', 'SYP'].map((c) => `<section class="card stat ${c === 'USD' ? 'accent' : ''}"><span class="label">المتبقي في هذه القائمة — ${c}</span><span class="value">${money(totals[c] || 0, c)}</span><span class="hint">${list.filter((r) => r.currency === c).length} ذمة</span></section>`).join('')}
        </div>
        <section class="card">
            <div class="filters">
                <input class="input" id="f-q" type="search" placeholder="ابحث باسم العميل أو المرجع أو الوصف" value="${esc(q)}" data-filter="q" aria-label="بحث">
                <select class="input" id="f-co" data-filter="company" aria-label="الشركة"><option value="">كل الشركات</option>${state.companies.map((x) => `<option value="${x.id}" ${co === String(x.id) ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
                <select class="input" id="f-cur" data-filter="currency" aria-label="العملة"><option value="">كل العملات</option>${['USD', 'SYP'].map((x) => `<option ${cur === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
                <select class="input" id="f-st" data-filter="status" aria-label="الحالة">
                    ${[['unpaid', 'غير المسدّدة'], ['overdue', 'المتأخرة فقط'], ['paid', 'المسدّدة'], ['all', 'الكل']].map(([v, l]) => `<option value="${v}" ${stf === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            ${table('<th>العميل</th><th>الوصف</th><th class="num">الأصل</th><th class="num">المتبقي</th><th>الاستحقاق</th><th>الحالة</th><th></th>', list.map((r) => receivableRow(r, true)), 'لا توجد ذمم مطابقة', 'غيّر الفلاتر لعرض ذمم أخرى.')}
        </section>`;
    }

    function viewCollect(id) {
        const r = receivable(id);
        if (!r) return notFound();
        if (!can('collect')) return pageHead('cash', 'تسجيل تحصيل', '') + forbidden('تسجيل المبالغ المستلمة من العملاء عمل المحصّل أو المدير.');
        const rem = remainingOf(r);
        const c = customer(r.customer);
        return pageHead('cash', 'تسجيل تحصيل', `من ${esc(c.name)} على ذمة ${esc(r.ref || r.description)}`, `<a class="btn btn-secondary" href="#/receivables">رجوع</a>`) + `
        <div class="grid cols-3">
            <section class="card stat"><span class="label">أصل الذمة</span><span class="value">${money(r.amount, r.currency)}</span></section>
            <section class="card stat"><span class="label">تم تحصيله</span><span class="value">${money(collectedOf(r), r.currency, 'pos')}</span></section>
            <section class="card stat accent"><span class="label">المتبقي على العميل</span><span class="value">${money(rem, r.currency, 'neg')}</span></section>
        </div>
        ${rem === 0 ? `<div class="alert positive">${icon('check')}<span>هذه الذمة مسدّدة بالكامل.</span></div>` : card('بيانات المبلغ المستلم', `<form class="form" data-form="collect" data-receivable="${r.id}" novalidate>
            ${inputField('amount', 'المبلغ المستلم', { required: true, placeholder: '0.00', ltr: true, inputmode: 'decimal', hint: `لا يمكن أن يتجاوز المتبقي: ${amt(rem, r.currency)}` })}
            ${inputField('currency', 'العملة', { value: r.currency, readonly: true, ltr: true, hint: 'تؤخذ تلقائياً من الذمة — لا تحويل عملات.' })}
            ${selectField('method', 'طريقة الاستلام', Object.entries(METHODS), true)}
            ${inputField('ref', 'رقم العملية / المرجع', { placeholder: 'اختياري', ltr: true })}
            <div class="form-actions">
                <button class="btn btn-primary" type="submit">${icon('check')}تسجيل المبلغ المستلم</button>
                <button class="btn btn-ghost" type="button" data-action="fill-remaining" data-amount="${fmt(rem)}">المبلغ المتبقي كاملاً</button>
            </div>
        </form>`, { desc: `بعد التسجيل يصبح المبلغ بعهدة ${esc(me().name)} حتى يسلّمه للصندوق.` })}`;
    }

    function viewCollections(params) {
        const co = params.company || '';
        const cur = params.currency || '';
        const col = params.collector || '';
        const list = state.collections.filter((k) => (!co || String(k.company) === co) && (!cur || k.currency === cur) && (!col || String(k.collector) === col))
            .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        return pageHead('cash', 'التحصيلات', 'كل مبلغ مستلم ومرحلته الحالية في مسار العهدة والصندوق.') + `
        <section class="card">
            <div class="filters">
                <select class="input" id="f-co" data-filter="company" aria-label="الشركة"><option value="">كل الشركات</option>${state.companies.map((x) => `<option value="${x.id}" ${co === String(x.id) ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
                <select class="input" id="f-cur" data-filter="currency" aria-label="العملة"><option value="">كل العملات</option>${['USD', 'SYP'].map((x) => `<option ${cur === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
                <select class="input" id="f-col" data-filter="collector" aria-label="المحصّل"><option value="">كل المحصّلين</option>${state.users.filter((x) => x.role !== 'accounting').map((x) => `<option value="${x.id}" ${col === String(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
            </div>
            ${table('<th>رقم التحصيل</th><th>العميل</th><th>التاريخ</th><th>المحصّل</th><th class="num">المبلغ</th><th class="num">بالعهدة</th><th>المرحلة</th>', list.map((k) => {
                const st = collectionStage(k);
                const cu = custodyOf(k);
                return `<tr><td><a href="#/collections/${k.id}"><bdi dir="ltr">${k.number}</bdi></a><span class="sub">${METHODS[k.method]}</span></td><td>${esc(customer(k.customer).name)}<span class="sub">${companyBadge(k.company)}</span></td><td><bdi dir="ltr">${fmtDT(k.receivedAt, company(k.company).tz)}</bdi></td><td>${esc(user(k.collector).name)}</td><td class="num">${money(k.amount, k.currency)}</td><td class="num">${cu ? money(cu, k.currency, 'gold') : '<span class="muted">—</span>'}</td><td><span class="badge ${st.tone}">${st.label}</span></td></tr>`;
            }), 'لا توجد تحصيلات مطابقة')}
        </section>`;
    }

    function viewCollection(id) {
        const k = collection(id);
        if (!k) return notFound();
        const c = company(k.company);
        const box = boxFor(k.company, k.currency);
        const cu = custodyOf(k);
        const moves = state.movements.filter((m) => m.collection === k.id);
        const handoverAllowed = can('handover', k);

        let handover = '';
        if (cu > 0 && handoverAllowed) {
            handover = card('تسليم إلى الصندوق', `<form class="form" data-form="handover" data-collection="${k.id}" novalidate>
                ${inputField('amount', 'المبلغ المسلَّم', { required: true, ltr: true, inputmode: 'decimal', value: fmt(cu), hint: `المتاح بالعهدة: ${amt(cu, k.currency)}` })}
                ${inputField('box', 'إلى صندوق', { value: box.name, readonly: true, hint: 'صندوق الشركة بنفس عملة التحصيل — يُحدَّد تلقائياً.' })}
                <div class="form-actions"><button class="btn btn-gold" type="submit">${icon('send')}تأكيد التسليم</button></div>
            </form>`, { desc: 'المبلغ لا يدخل رصيد الصندوق إلا بعد أن تؤكد المحاسبة استلامه.' });
        } else if (cu > 0) {
            handover = `<div class="alert info">${icon('info')}<span>المبلغ بعهدة ${esc(user(k.collector).name)}. التسليم يسجّله المحصّل نفسه أو المدير، ولا يستطيع محصّل آخر التصرف بعهدة غيره.</span></div>`;
        }

        const rows = moves.map((m) => {
            const s = state.settlements.find((x) => x.movement === m.id);
            const conf = s.status === 'confirmed'
                ? `<span class="badge positive">مؤكَّد</span><span class="sub">${esc(user(s.confirmedBy).name)}، <bdi dir="ltr">${fmtDT(s.confirmedAt, c.tz)}</bdi></span>`
                : '<span class="badge warning">بانتظار الصندوق</span>';
            return `<tr><td><bdi dir="ltr">${fmtDT(m.at, c.tz)}</bdi></td><td class="num">${money(m.amount, k.currency)}</td><td>${esc(m.recipient)}</td><td>${esc(user(m.by).name)}</td><td>${conf}</td><td>${s.tx ? `<bdi dir="ltr">#${s.tx}</bdi>` : '—'}</td></tr>`;
        });

        return pageHead('cash', `تحصيل <bdi dir="ltr">${k.number}</bdi>`, `${esc(customer(k.customer).name)}، ${METHODS[k.method]}${k.ref ? '، مرجع ' + esc(k.ref) : ''}`, `<a class="btn btn-secondary" href="#/customers/${k.customer}">ملف العميل</a>`) + `
        ${card('أين هذا المبلغ الآن؟', trail(k), { flush: true })}
        <div class="grid cols-3">
            <section class="card stat"><span class="label">المبلغ المستلم</span><span class="value">${money(k.amount, k.currency)}</span><span class="hint"><bdi dir="ltr">${fmtDT(k.receivedAt, c.tz)}</bdi> بتوقيت ${c.city}</span></section>
            <section class="card stat"><span class="label">سُلّم للصندوق</span><span class="value">${money(handedOf(k), k.currency, 'pos')}</span></section>
            <section class="card stat accent"><span class="label">الموجود بالعهدة حالياً</span><span class="value">${money(cu, k.currency, cu ? 'gold' : '')}</span><span class="hint">${cu ? 'بحوزة ' + esc(user(k.collector).name) : 'لا شيء بالعهدة'}</span></section>
        </div>
        ${handover}
        ${card('سجل التسليمات', table('<th>التاريخ</th><th class="num">المبلغ</th><th>إلى</th><th>سلّمه</th><th>استلام الصندوق</th><th>قيد الصندوق</th>', rows, 'لم يتم تسجيل أي تسليم بعد', 'كامل المبلغ ما زال بعهدة المحصّل.'), { flush: true })}`;
    }

    function viewCustody() {
        if (!can('custody')) return pageHead('wallet', 'المبالغ بعهدتي', '') + forbidden('العهدة تخص المحصّلين. المحاسبة ترى التسليمات من شاشة الخزينة.');
        const u = me();
        const mine = state.collections.filter((k) => custodyOf(k) > 0 && (u.role === 'admin' || k.collector === u.id));
        const totals = byCurrency(mine, custodyOf, (k) => k.currency);
        const perCollector = u.role === 'admin' ? card('العهدة لكل محصّل', table('<th>المحصّل</th><th class="num">USD</th><th class="num">SYP</th><th>عدد التحصيلات</th>', state.users.filter((x) => x.role === 'collector').map((x) => {
            const ks = mine.filter((k) => k.collector === x.id);
            const t = byCurrency(ks, custodyOf, (k) => k.currency);
            return `<tr><td><b>${esc(x.name)}</b></td><td class="num">${t.USD ? money(t.USD, 'USD', 'gold') : '—'}</td><td class="num">${t.SYP ? money(t.SYP, 'SYP', 'gold') : '—'}</td><td>${ks.length}</td></tr>`;
        }), ''), { flush: true }) : '';
        return pageHead('wallet', u.role === 'admin' ? 'العهدة لدى المحصّلين' : 'المبالغ بعهدتي', 'مبالغ مستلمة من العملاء ولم تُسلَّم للصندوق بعد.') + `
        <div class="grid cols-2">${['USD', 'SYP'].map((c) => `<section class="card stat ${c === 'USD' ? 'accent' : ''}"><span class="label">بالعهدة — ${c}</span><span class="value">${money(totals[c] || 0, c, totals[c] ? 'gold' : '')}</span></section>`).join('')}</div>
        ${perCollector}
        ${card('التحصيلات غير المسلَّمة', table('<th>التحصيل</th><th>العميل</th><th>المحصّل</th><th class="num">بالعهدة</th><th></th>', mine.map((k) => `<tr><td><a href="#/collections/${k.id}"><bdi dir="ltr">${k.number}</bdi></a></td><td>${esc(customer(k.customer).name)}</td><td>${esc(user(k.collector).name)}</td><td class="num">${money(custodyOf(k), k.currency, 'gold')}</td><td>${can('handover', k) ? `<a class="btn btn-gold btn-sm" href="#/collections/${k.id}">${icon('send')}تسليم</a>` : ''}</td></tr>`), 'لا شيء بعهدتك الآن', 'كل ما استلمته سُلّم للصندوق.'), { flush: true })}`;
    }

    function treasuryTabs(active) {
        const pending = state.settlements.filter((s) => s.status === 'pending').length;
        return `<nav class="tabs" aria-label="أقسام الخزينة">
            <a href="#/treasury" ${active === 'daily' ? 'aria-current="page"' : ''}>اليوم الحالي</a>
            <a href="#/treasury/settlements" ${active === 'settlements' ? 'aria-current="page"' : ''}>تسليمات المحصّلين${pending ? ` (${pending})` : ''}</a>
            <a href="#/treasury/closings" ${active === 'closings' ? 'aria-current="page"' : ''}>الإقفالات</a>
            <a href="#/treasury/transfer" ${active === 'transfer' ? 'aria-current="page"' : ''}>تحويل داخلي</a>
        </nav>`;
    }

    function viewTreasury(params) {
        if (!can('treasury')) return pageHead('vault', 'الصندوق اليومي', '') + forbidden('الصندوق من صلاحيات المحاسبة والمدير. المحصّل يسلّم عهدته فقط.');
        const boxId = Number(params.box) || 1;
        const box = cashbox(boxId) || cashbox(1);
        const co = company(box.company);
        const today = todayFor(box.company);
        const d = openDay(box.id);
        const closedToday = state.days.find((x) => x.cashbox === box.id && x.date === today && x.status === 'closed');
        const prev = lastClosed(box.id);

        const boxTabs = `<nav class="tabs" aria-label="الصندوق">${state.cashboxes.map((b) => `<a href="#/treasury?box=${b.id}" ${b.id === box.id ? 'aria-current="page"' : ''}>${esc(b.name)}</a>`).join('')}</nav>`;

        let body;
        if (d && d.date !== today) {
            body = card(`يوم ${ltr(d.date)} ما زال مفتوحاً`, `<div class="alert warning">${icon('alert')}<span>لا يُفتح يوم جديد قبل إقفال اليوم السابق لنفس الصندوق.</span></div>`) + dayCard(d, box, co);
        } else if (d) {
            body = dayCard(d, box, co);
        } else if (closedToday) {
            body = closedCard(closedToday, box) + `<div class="alert info">${icon('info')}<span>يوم ${ltr(today)} مُقفل. اليوم التالي يفتح برصيد افتتاحي ${amt(closedToday.actual, box.currency)} تلقائياً.</span></div>`;
        } else {
            body = card(`فتح يوم ${ltr(today)}`, prev
                ? `<form class="form" data-form="open-day" data-box="${box.id}">
                    ${inputField('opening', 'الرصيد الافتتاحي', { value: fmt(prev.actual) + ' ' + box.currency, readonly: true, ltr: true, hint: `مُرحَّل تلقائياً من الرصيد الفعلي لإقفال ${ltr(prev.date)} — لا يُدخل يدوياً.` })}
                    <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('vault')}فتح اليوم</button></div>
                </form>`
                : `<form class="form" data-form="open-day" data-box="${box.id}" novalidate>
                    ${inputField('opening', 'الرصيد الافتتاحي (أول يوم فقط)', { required: true, ltr: true, placeholder: '0.00', inputmode: 'decimal', hint: 'من عدّ فعلي للنقد. هذه المرة الوحيدة التي يُدخل فيها يدوياً.' })}
                    <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('vault')}فتح اليوم</button></div>
                </form>`, { desc: `${esc(box.name)} — بتوقيت ${co.city}` });
        }

        return pageHead('vault', 'الصندوق اليومي', 'فتح اليوم، تسجيل الحركات، ثم الإقفال بالرصيد الفعلي المعدود.') + treasuryTabs('daily') + boxTabs + body;
    }

    function dayCard(d, box, co) {
        const t = dayTotals(d);
        const rows = [...t.list].sort((a, b) => a.at.localeCompare(b.at)).map((x) => `<tr>
            <td><bdi dir="ltr">${timeIn(co.tz, new Date(x.at))}</bdi></td>
            <td>${x.direction === 'in' ? '<span class="badge positive">داخل</span>' : '<span class="badge negative">خارج</span>'}</td>
            <td>${TX_LABELS[x.category] || x.category}</td>
            <td>${esc(x.party || '—')}</td>
            <td class="num">${money(x.amount, box.currency, x.direction === 'in' ? 'pos' : 'neg')}</td>
            <td>${esc(user(x.by).name)}</td>
        </tr>`);
        const isToday = d.date === todayFor(box.company);
        return `
        <div class="grid cols-4">
            <section class="card stat"><span class="label">الرصيد الافتتاحي</span><span class="value">${money(d.opening, box.currency)}</span><span class="hint">يوم <bdi dir="ltr">${d.date}</bdi></span></section>
            <section class="card stat"><span class="label">إجمالي الداخل</span><span class="value">${money(t.inn, box.currency, 'pos')}</span></section>
            <section class="card stat"><span class="label">إجمالي الخارج</span><span class="value">${money(t.out, box.currency, 'neg')}</span></section>
            <section class="card stat accent"><span class="label">الرصيد المتوقع حالياً</span><span class="value">${money(t.expected, box.currency)}</span></section>
        </div>
        ${isToday ? card('إضافة حركة', `<form class="form" data-form="tx" data-box="${box.id}" novalidate>
            ${selectField('direction', 'الاتجاه', [['in', 'داخل'], ['out', 'خارج']], true)}
            ${selectField('category', 'الفئة', Object.entries({ ...TX_CATEGORIES.in, ...TX_CATEGORIES.out }), true)}
            ${inputField('amount', 'المبلغ', { required: true, ltr: true, placeholder: '0.00', inputmode: 'decimal', hint: `بعملة الصندوق فقط: ${box.currency}` })}
            ${inputField('party', 'الجهة / البيان')}
            <div class="form-actions"><button class="btn btn-secondary" type="submit">${icon('plus')}إضافة الحركة</button></div>
        </form>`, { desc: 'تسليمات المحصّلين تُضاف تلقائياً عند تأكيدها — لا تُدخل يدوياً.' }) : ''}
        ${card('حركات اليوم', table('<th>الوقت</th><th>الاتجاه</th><th>الفئة</th><th>البيان</th><th class="num">المبلغ</th><th>أدخلها</th>', rows, 'لا توجد حركات في هذا اليوم'), { flush: true })}
        ${card('إقفال اليوم', `<form class="form" data-form="close-day" data-day="${d.id}" novalidate>
            ${inputField('actual', 'الرصيد الفعلي الموجود بالصندوق', { required: true, ltr: true, placeholder: '0.00', inputmode: 'decimal', hint: `المتوقع: ${amt(t.expected, box.currency)}` })}
            ${inputField('notes', 'سبب الفرق / ملاحظة', { placeholder: 'مطلوب عند وجود فرق' })}
            <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('lock')}إقفال اليوم</button></div>
        </form>`, { desc: 'عُدّ النقد فعلياً. أي فرق عن المتوقع يحتاج سبباً مكتوباً، والرصيد الفعلي يُرحَّل لليوم التالي.' })}`;
    }

    function closedCard(d, box) {
        const t = dayTotals(d);
        const tone = d.diff === 0 ? 'pos' : 'neg';
        return card(`يوم <bdi dir="ltr">${d.date}</bdi> — مُقفل`, `<dl class="dl">
            <div><dt>الرصيد الافتتاحي</dt><dd>${money(d.opening, box.currency)}</dd></div>
            <div><dt>الداخل</dt><dd>${money(t.inn, box.currency, 'pos')}</dd></div>
            <div><dt>الخارج</dt><dd>${money(t.out, box.currency, 'neg')}</dd></div>
            <div><dt>المتوقع</dt><dd>${money(d.expected, box.currency)}</dd></div>
            <div><dt>الفعلي</dt><dd>${money(d.actual, box.currency)}</dd></div>
            <div><dt>الفرق</dt><dd>${d.diff === 0 ? '<span class="badge positive">مطابق</span>' : money(d.diff, box.currency, tone)}</dd></div>
            <div><dt>أقفله</dt><dd>${esc(user(d.closedBy).name)}</dd></div>
            ${d.notes ? `<div><dt>سبب الفرق</dt><dd>${esc(d.notes)}</dd></div>` : ''}
        </dl>`);
    }

    function viewSettlements(params) {
        if (!can('treasury')) return pageHead('vault', 'تسليمات المحصّلين', '') + forbidden('تأكيد استلام التسليمات من صلاحيات المحاسبة والمدير.');
        const stf = params.status || 'pending';
        const list = state.settlements.filter((s) => stf === 'all' || s.status === stf).sort((a, b) => b.handedAt.localeCompare(a.handedAt));
        const pending = state.settlements.filter((s) => s.status === 'pending');
        const rows = list.map((s) => {
            const k = collection(s.collection);
            const co = company(s.company);
            const d = openDay(s.cashbox);
            const dayOk = d && d.date === todayFor(s.company);
            const status = s.status === 'confirmed'
                ? `<span class="badge positive">مؤكَّد</span><span class="sub">قيد <bdi dir="ltr">#${s.tx}</bdi></span>`
                : `<span class="badge warning">بانتظار التأكيد</span>${dayOk ? '' : `<span class="sub" style="color:var(--negative)">يوم الصندوق غير مفتوح</span>`}`;
            return `<tr>
                <td><b>${esc(user(s.collector).name)}</b></td>
                <td>${esc(customer(k.customer).name)}<span class="sub"><a href="#/collections/${k.id}"><bdi dir="ltr">${k.number}</bdi></a></span></td>
                <td>${esc(cashbox(s.cashbox).name)}</td>
                <td><bdi dir="ltr">${fmtDT(s.handedAt, co.tz)}</bdi></td>
                <td class="num">${money(s.amount, s.currency)}</td>
                <td>${status}</td>
                <td>${s.status === 'pending' ? `<button class="btn btn-primary btn-sm" type="button" data-action="confirm-settlement" data-id="${s.id}">${icon('check')}تأكيد الاستلام</button>` : ''}</td>
            </tr>`;
        });
        return pageHead('vault', 'تسليمات المحصّلين', 'المبلغ المسلَّم لا يدخل رصيد أي صندوق إلا بعد تأكيد استلامه.') + treasuryTabs('settlements') + `
        <div class="grid cols-2">
            <section class="card stat accent"><span class="label">بانتظار التأكيد</span><span class="value">${moneyList(byCurrency(pending, (s) => s.amount, (s) => s.currency))}</span><span class="hint">${pending.length} تسليم</span></section>
            <section class="card stat"><span class="label">مؤكَّد في الصناديق</span><span class="value">${moneyList(byCurrency(state.settlements.filter((s) => s.status === 'confirmed'), (s) => s.amount, (s) => s.currency), 'pos')}</span></section>
        </div>
        <section class="card">
            <div class="filters"><select class="input" id="f-st" data-filter="status" aria-label="الحالة">${[['pending', 'بانتظار التأكيد'], ['confirmed', 'المؤكَّدة'], ['all', 'الكل']].map(([v, l]) => `<option value="${v}" ${stf === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            ${table('<th>المحصّل</th><th>العميل / التحصيل</th><th>الصندوق</th><th>وقت التسليم</th><th class="num">المبلغ</th><th>الحالة</th><th></th>', rows, stf === 'pending' ? 'لا توجد تسليمات معلّقة' : 'لا توجد تسليمات', stf === 'pending' ? 'كل التسليمات مؤكَّدة في صناديقها.' : '')}
        </section>`;
    }

    function viewClosings() {
        if (!can('treasury')) return pageHead('vault', 'الإقفالات', '') + forbidden('الإقفالات من صلاحيات المحاسبة والمدير.');
        const days = state.days.filter((d) => d.status === 'closed').sort((a, b) => b.date.localeCompare(a.date) || a.cashbox - b.cashbox);
        return pageHead('vault', 'الإقفالات اليومية', 'كل يوم مُقفل برصيده المتوقع والفعلي والفرق وسببه.') + treasuryTabs('closings') + card('', table('<th>الصندوق</th><th>اليوم</th><th class="num">الافتتاحي</th><th class="num">المتوقع</th><th class="num">الفعلي</th><th class="num">الفرق</th><th>أقفله</th><th>ملاحظة</th>', days.map((d) => {
            const b = cashbox(d.cashbox);
            return `<tr><td><b>${esc(b.name)}</b></td><td><bdi dir="ltr">${d.date}</bdi></td><td class="num">${money(d.opening, b.currency)}</td><td class="num">${money(d.expected, b.currency)}</td><td class="num">${money(d.actual, b.currency)}</td><td class="num">${d.diff === 0 ? '<span class="badge positive">مطابق</span>' : money(d.diff, b.currency, 'neg')}</td><td>${esc(user(d.closedBy).name)}</td><td>${esc(d.notes || '—')}</td></tr>`;
        }), 'لا توجد أيام مُقفلة'), { flush: true });
    }

    function viewTransfer() {
        if (!can('treasury')) return pageHead('swap', 'تحويل داخلي', '') + forbidden('التحويل بين الصناديق من صلاحيات المحاسبة والمدير.');
        const opts = state.cashboxes.map((b) => [b.id, b.name]);
        return pageHead('swap', 'تحويل داخلي', 'نقل مبلغ بين صندوقين بنفس العملة.') + treasuryTabs('transfer') + `
        <div class="alert info">${icon('info')}<span>التحويل مسموح فقط بين صندوقين بنفس العملة. لا يوجد صرف عملات في النظام، لذلك لا يمكن التحويل من <bdi dir="ltr">FREE LINE — SYP</bdi> إلى أي صندوق دولار.</span></div>
        ${card('تنفيذ تحويل', `<form class="form" data-form="transfer" novalidate>
            ${selectField('from', 'من صندوق', opts, true)}
            ${selectField('to', 'إلى صندوق', opts, true, '', 3)}
            ${inputField('amount', 'المبلغ', { required: true, ltr: true, placeholder: '0.00', inputmode: 'decimal' })}
            <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('swap')}تنفيذ التحويل</button></div>
        </form>`, { desc: 'يُسجَّل قيد صادر من الصندوق الأول وقيد وارد في الثاني. يجب أن يكون يوم الصندوقين مفتوحاً.' })}`;
    }

    function viewReports() {
        if (!can('reports')) return pageHead('chart', 'التقارير', '') + forbidden('التقارير المالية من صلاحيات المحاسبة والمدير.');
        const rows = [];
        state.companies.forEach((co) => co.currencies.forEach((cur) => {
            const recs = state.receivables.filter((r) => r.company === co.id && r.currency === cur);
            const total = sum(recs, (r) => r.amount);
            const col = sum(recs, collectedOf);
            const rate = total ? Math.round((col / total) * 100) : 0;
            rows.push(`<tr><td><b>${co.name}</b></td><td><bdi dir="ltr">${cur}</bdi></td><td class="num">${money(total, cur)}</td><td class="num">${money(col, cur, 'pos')}</td><td class="num">${money(total - col, cur, 'neg')}</td>
                <td style="min-width:160px"><div class="row" style="flex-wrap:nowrap"><span class="tour" style="position:static;box-shadow:none;border:0;width:100%;background:none"><span class="bar" style="display:block"><i style="width:${rate}%"></i></span></span><b class="small tnum">${rate}%</b></div></td></tr>`);
        }));
        const collectors = state.users.filter((u) => u.role === 'collector' || u.role === 'admin').map((u) => {
            const ks = state.collections.filter((k) => k.collector === u.id);
            if (!ks.length) return '';
            const t = byCurrency(ks, (k) => k.amount, (k) => k.currency);
            const cu = byCurrency(ks.filter((k) => custodyOf(k) > 0), custodyOf, (k) => k.currency);
            return `<tr><td><b>${esc(u.name)}</b></td><td>${ks.length}</td><td class="num">${moneyList(t, 'pos')}</td><td class="num">${moneyList(cu, 'gold')}</td></tr>`;
        }).filter(Boolean);
        const boxes = state.cashboxes.map((b) => {
            const d = openDay(b.id);
            const p = lastClosed(b.id);
            return `<tr><td><b>${esc(b.name)}</b></td><td class="num">${p ? money(p.actual, b.currency) : '—'}</td><td class="num">${d ? money(dayTotals(d).expected, b.currency) : '<span class="muted">اليوم غير مفتوح</span>'}</td></tr>`;
        });
        return pageHead('chart', 'التقارير', 'كل رقم هنا بعملته — لا يوجد إجمالي يجمع الدولار مع الليرة.') + `
        ${card('نسبة التحصيل لكل شركة وعملة', table('<th>الشركة</th><th>العملة</th><th class="num">إجمالي الذمم</th><th class="num">المُحصَّل</th><th class="num">المتبقي</th><th>النسبة</th>', rows, ''), { flush: true })}
        <div class="grid cols-2">
            ${card('أداء المحصّلين', table('<th>المحصّل</th><th>التحصيلات</th><th class="num">المُحصَّل</th><th class="num">بالعهدة</th>', collectors, 'لا توجد تحصيلات'), { flush: true })}
            ${card('أرصدة الصناديق', table('<th>الصندوق</th><th class="num">آخر رصيد فعلي مُقفل</th><th class="num">المتوقع الآن</th>', boxes, ''), { flush: true })}
        </div>`;
    }

    function viewAudit() {
        if (!can('audit')) return pageHead('shield', 'سجل النشاط', '') + forbidden('سجل النشاط يطّلع عليه المدير فقط.');
        const list = [...state.audit].reverse();
        return pageHead('shield', 'سجل النشاط', 'كل عملية مالية تُسجَّل هنا باسم منفّذها ووقتها. السجل لا يُعدَّل ولا يُحذف.') + card('', table('<th>الوقت (UTC)</th><th>المستخدم</th><th>القسم</th><th>العملية</th>', list.map((a) => `<tr><td><bdi dir="ltr">${a.at.slice(0, 16).replace('T', ' ')}</bdi></td><td>${esc(user(a.user).name)}</td><td><span class="badge neutral">${esc(a.module)}</span></td><td>${esc(a.summary)}</td></tr>`), 'لا يوجد نشاط'), { flush: true });
    }

    function notFound() {
        return card('', '<div class="empty"><b>الصفحة غير موجودة</b><a href="#/dashboard">العودة إلى لوحة التحكم</a></div>');
    }

    // ================================================================ حقول النماذج

    function inputField(name, label, o = {}) {
        const id = `in-${name}`;
        return `<div class="field ${o.full ? 'full' : ''}">
            <label for="${id}">${label}${o.required ? ' <span class="req">*</span>' : ''}</label>
            <input class="input ${o.ltr ? 'ltr' : ''}" id="${id}" name="${name}" type="${o.type || 'text'}" ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''} ${o.value !== undefined ? `value="${esc(o.value)}"` : ''} ${o.readonly ? 'readonly' : ''} ${o.inputmode ? `inputmode="${o.inputmode}"` : ''} autocomplete="off">
            ${o.hint ? `<span class="hint">${o.hint}</span>` : ''}
            <span class="err" data-err="${name}"></span>
        </div>`;
    }

    function selectField(name, label, options, required, hint = '', selected) {
        const id = `in-${name}`;
        return `<div class="field">
            <label for="${id}">${label}${required ? ' <span class="req">*</span>' : ''}</label>
            <select class="input" id="${id}" name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
            ${hint ? `<span class="hint">${hint}</span>` : ''}
            <span class="err" data-err="${name}"></span>
        </div>`;
    }

    function fieldError(form, name, msg) {
        const el = form.querySelector(`[data-err="${name}"]`);
        if (el) el.textContent = msg;
        const input = form.querySelector(`[name="${name}"]`);
        if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
        return false;
    }

    // ================================================================ العرض

    function render() {
        const app = $('#app');
        const active = document.activeElement;
        const focusId = active && active.id && active.matches('[data-filter]') ? active.id : null;
        const caret = focusId && typeof active.selectionStart === 'number' ? active.selectionStart : null;

        if (!me()) {
            if (location.hash && location.hash !== '#/') { history.replaceState(null, '', '#/'); }
            app.innerHTML = viewEntry();
            document.title = 'FREE LINE Collections — نسخة تجريبية';
            return;
        }

        const { parts, params } = route();
        const [a, b, c] = parts;
        let title;
        let key;
        let body;

        if (!a || a === 'dashboard') { title = 'لوحة التحكم'; key = 'dashboard'; body = viewDashboard(); }
        else if (a === 'customers' && b) { title = 'تفاصيل العميل'; key = 'customers'; body = viewCustomer(Number(b)); }
        else if (a === 'customers') { title = 'العملاء'; key = 'customers'; body = viewCustomers(params); }
        else if (a === 'receivables' && b && c === 'collect') { title = 'تسجيل تحصيل'; key = 'receivables'; body = viewCollect(Number(b)); }
        else if (a === 'receivables') { title = 'الذمم'; key = 'receivables'; body = viewReceivables(params); }
        else if (a === 'collections' && b) { title = 'تفاصيل التحصيل'; key = 'collections'; body = viewCollection(Number(b)); }
        else if (a === 'collections') { title = 'التحصيلات'; key = 'collections'; body = viewCollections(params); }
        else if (a === 'custody') { title = 'العهدة'; key = 'custody'; body = viewCustody(); }
        else if (a === 'treasury' && b === 'settlements') { title = 'تسليمات المحصّلين'; key = 'treasury'; body = viewSettlements(params); }
        else if (a === 'treasury' && b === 'closings') { title = 'الإقفالات'; key = 'treasury'; body = viewClosings(); }
        else if (a === 'treasury' && b === 'transfer') { title = 'تحويل داخلي'; key = 'treasury'; body = viewTransfer(); }
        else if (a === 'treasury') { title = 'الصندوق اليومي'; key = 'treasury'; body = viewTreasury(params); }
        else if (a === 'reports') { title = 'التقارير'; key = 'reports'; body = viewReports(); }
        else if (a === 'audit') { title = 'سجل النشاط'; key = 'audit'; body = viewAudit(); }
        else { title = 'غير موجودة'; key = ''; body = notFound(); }

        app.innerHTML = layout(title, body, key);
        document.title = `${title} — FREE LINE Collections (تجريبي)`;

        if (focusId) {
            const el = document.getElementById(focusId);
            if (el) { el.focus(); if (caret !== null) { try { el.setSelectionRange(caret, caret); } catch (e) { /* select */ } } }
        }
    }

    function commit(msg, hash) {
        save();
        if (msg) toast(msg);
        if (hash && location.hash !== hash) { go(hash); } else { render(); }
    }

    function toast(msg, isError) {
        const el = document.createElement('div');
        el.className = 'toast' + (isError ? ' error' : '');
        el.textContent = msg;
        $('#toasts').appendChild(el);
        setTimeout(() => el.remove(), isError ? 5200 : 3600);
    }

    function confirmAction(message) {
        const dlg = $('#confirm');
        if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(message));
        $('#confirm-body').textContent = message;
        dlg.returnValue = '';
        dlg.showModal();
        return new Promise((resolve) => {
            dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
        });
    }

    /** ينفّذ عملية؛ يعيد نتيجتها أو true إن لم تُعِد شيئاً، وfalse عند خرق قاعدة عمل. */
    function attempt(fn) {
        try { const out = fn(); return out === undefined ? true : out; } catch (e) {
            if (e instanceof RuleError) { toast(e.message, true); return false; }
            throw e;
        }
    }

    // ================================================================ الأحداث

    document.addEventListener('click', async (ev) => {
        const t = ev.target.closest('[data-action]');
        if (!t) {
            const shell = $('#shell');
            if (shell && shell.classList.contains('nav-open') && !ev.target.closest('.side')) shell.classList.remove('nav-open');
            return;
        }
        const action = t.dataset.action;

        if (action === 'enter') {
            state.me = Number(t.dataset.user);
            save();
            go('#/dashboard');
            render();
        } else if (action === 'menu') {
            $('#shell').classList.toggle('nav-open');
        } else if (action === 'reset') {
            if (await confirmAction('إعادة البيانات التجريبية إلى حالتها الأولى؟ ستُحذف كل العمليات التي أجريتها في هذا المتصفح.')) {
                try { localStorage.removeItem(STORE_KEY); } catch (e) { /* */ }
                state = seed();
                save();
                history.replaceState(null, '', '#/');
                render();
                toast('عادت البيانات التجريبية إلى حالتها الأولى.');
            }
        } else if (action === 'fill-remaining') {
            const input = $('#in-amount');
            if (input) { input.value = t.dataset.amount; input.focus(); }
        } else if (action === 'confirm-settlement') {
            const st = state.settlements.find((s) => s.id === Number(t.dataset.id));
            if (!st) return;
            const ok = await confirmAction(`تأكيد استلام ${amt(st.amount, st.currency)} من ${user(st.collector).name} في ${ltr(cashbox(st.cashbox).name)}؟ سيُسجَّل قيد وارد في الصندوق ولا يمكن التراجع عنه.`);
            if (!ok) return;
            if (attempt(() => confirmSettlement(st, state.me))) {
                commit(`تم تأكيد استلام ${amt(st.amount, st.currency)} في ${ltr(cashbox(st.cashbox).name)}.`);
            }
        }
    });

    document.addEventListener('change', (ev) => {
        const t = ev.target;
        if (t.matches('[data-change="switch-user"]')) {
            state.me = Number(t.value);
            save();
            toast(`أنت الآن: ${me().name} (${ROLES[me().role]})`);
            render();
        } else if (t.matches('select[data-filter]')) {
            applyFilter(t.dataset.filter, t.value);
        }
    });

    document.addEventListener('input', (ev) => {
        const t = ev.target;
        if (t.matches('input[data-filter]')) applyFilter(t.dataset.filter, t.value);
    });

    document.addEventListener('toggle', (ev) => {
        if (ev.target.matches && ev.target.matches('[data-toggle="tour"]')) {
            state.ui.tourOpen = ev.target.open;
            save();
        }
    }, true);

    function applyFilter(name, value) {
        const { path, params } = route();
        if (value) params[name] = value; else delete params[name];
        const qs = new URLSearchParams(params).toString();
        history.replaceState(null, '', `#${path}${qs ? '?' + qs : ''}`);
        render();
    }

    document.addEventListener('submit', async (ev) => {
        const form = ev.target.closest('form[data-form]');
        if (!form) return;
        ev.preventDefault();
        form.querySelectorAll('[data-err]').forEach((e) => { e.textContent = ''; });
        form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
        const data = Object.fromEntries(new FormData(form));
        const kind = form.dataset.form;

        if (kind === 'customer') {
            if (!data.name.trim()) return fieldError(form, 'name', 'حقل اسم العميل مطلوب.');
            if (!data.phone.trim()) return fieldError(form, 'phone', 'حقل رقم الهاتف مطلوب.');
            const c = { id: nextId('customers'), company: Number(data.company), name: data.name.trim(), phone: data.phone.trim(), contact: data.contact.trim(), active: true, createdAt: new Date().toISOString() };
            state.customers.push(c);
            audit('customer.created', 'العملاء', `إضافة العميل ${c.name} (${company(c.company).name})`);
            commit('تمت إضافة العميل بنجاح.', `#/customers/${c.id}`);
        } else if (kind === 'receivable') {
            const cust = customer(Number(form.dataset.customer));
            const amount = parseAmount(data.amount);
            if (!data.description.trim()) return fieldError(form, 'description', 'حقل وصف الذمة مطلوب.');
            if (!amount) return fieldError(form, 'amount', 'أدخل مبلغاً صحيحاً أكبر من صفر (منزلتان عشريتان كحد أقصى).');
            if (!company(cust.company).currencies.includes(data.currency)) return fieldError(form, 'currency', `${company(cust.company).name} لا تتعامل بعملة ${data.currency}.`);
            const r = { id: nextId('receivables'), customer: cust.id, company: cust.company, currency: data.currency, amount, description: data.description.trim(), ref: data.ref.trim(), due: data.due || todayFor(cust.company), createdAt: new Date().toISOString(), createdBy: state.me };
            state.receivables.push(r);
            audit('receivable.created', 'الذمم', `ذمة جديدة على ${cust.name}: ${amt(amount, r.currency)}`);
            commit('تم حفظ الذمة.');
        } else if (kind === 'collect') {
            const r = receivable(Number(form.dataset.receivable));
            const amount = parseAmount(data.amount);
            if (!amount) return fieldError(form, 'amount', 'أدخل مبلغاً صحيحاً أكبر من صفر.');
            if (amount > remainingOf(r)) return fieldError(form, 'amount', `لا يمكن أن يتجاوز المبلغ المتبقي (${amt(remainingOf(r), r.currency)}).`);
            const k = attempt(() => createCollection(r, state.me, amount, data.method, data.ref.trim()));
            if (k) commit(`تم تسجيل ${amt(amount, r.currency)} — المبلغ الآن بعهدتك.`, `#/collections/${k.id}`);
        } else if (kind === 'handover') {
            const k = collection(Number(form.dataset.collection));
            const amount = parseAmount(data.amount);
            if (!amount) return fieldError(form, 'amount', 'أدخل مبلغاً صحيحاً أكبر من صفر.');
            if (amount > custodyOf(k)) return fieldError(form, 'amount', `المتاح بالعهدة ${amt(custodyOf(k), k.currency)} فقط.`);
            const box = boxFor(k.company, k.currency);
            if (!await confirmAction(`تسليم ${amt(amount, k.currency)} إلى ${ltr(box.name)}؟ يبقى التسليم معلّقاً حتى تؤكد المحاسبة استلامه.`)) return;
            if (attempt(() => createHandover(k, state.me, amount))) commit('تم تسجيل التسليم — بانتظار تأكيد الصندوق.');
        } else if (kind === 'open-day') {
            const boxId = Number(form.dataset.box);
            const manual = lastClosed(boxId) ? null : parseAmount(data.opening);
            if (!lastClosed(boxId) && manual === null) return fieldError(form, 'opening', 'أدخل رصيداً افتتاحياً صحيحاً (صفر أو أكثر).');
            if (attempt(() => openBoxDay(boxId, manual))) commit('تم فتح يوم الصندوق.');
        } else if (kind === 'tx') {
            const amount = parseAmount(data.amount);
            if (!amount) return fieldError(form, 'amount', 'أدخل مبلغاً صحيحاً أكبر من صفر.');
            if (!TX_CATEGORIES[data.direction][data.category]) return fieldError(form, 'category', data.direction === 'in' ? 'اختر فئة من فئات الداخل.' : 'اختر فئة من فئات الخارج.');
            if (attempt(() => addManualTx(Number(form.dataset.box), data.direction, data.category, amount, data.party.trim()))) commit('تمت إضافة الحركة.');
        } else if (kind === 'close-day') {
            const d = state.days.find((x) => x.id === Number(form.dataset.day));
            const actual = parseAmount(data.actual);
            if (actual === null) return fieldError(form, 'actual', 'أدخل الرصيد الفعلي المعدود.');
            const diff = actual - dayTotals(d).expected;
            if (diff !== 0 && !data.notes.trim()) return fieldError(form, 'notes', `يوجد فرق ${amt(diff, cashbox(d.cashbox).currency)} — اكتب سبب الفرق قبل الإقفال.`);
            if (!await confirmAction(`إقفال يوم ${ltr(d.date)} في ${ltr(cashbox(d.cashbox).name)}؟ بعد الإقفال لا تُضاف حركات لهذا اليوم، والرصيد الفعلي يُرحَّل افتتاحياً لليوم التالي.`)) return;
            if (attempt(() => closeDayRecord(d, actual, data.notes.trim(), state.me))) {
                state.tour.close = true;
                commit('تم إقفال يوم الصندوق.');
            }
        } else if (kind === 'transfer') {
            const amount = parseAmount(data.amount);
            if (!amount) return fieldError(form, 'amount', 'أدخل مبلغاً صحيحاً أكبر من صفر.');
            const from = cashbox(Number(data.from));
            const to = cashbox(Number(data.to));
            if (from.currency !== to.currency) return fieldError(form, 'to', 'لا تحويل بين عملتين مختلفتين — اختر صندوقاً بنفس العملة.');
            if (!await confirmAction(`تحويل ${amt(amount, from.currency)} من ${ltr(from.name)} إلى ${ltr(to.name)}؟`)) return;
            if (attempt(() => transfer(from.id, to.id, amount))) commit('تم تنفيذ التحويل.', `#/treasury?box=${from.id}`);
        }
        return undefined;
    });

    window.addEventListener('hashchange', () => {
        const shell = $('#shell');
        if (shell) shell.classList.remove('nav-open');
        render();
        window.scrollTo(0, 0);
    });

    // تحديث ساعة الشركات كل دقيقة دون إعادة بناء الصفحة.
    setInterval(() => {
        const clock = document.querySelector('.top .clock');
        if (clock) clock.innerHTML = state.companies.map((c) => `<span>${c.city} <bdi dir="ltr">${timeIn(c.tz)}</bdi></span>`).join('');
    }, 30000);

    state = load();
    save();
    render();
}());
