class Component extends DCLogic {
  state = {
    page: "dashboard",
    data: this.seed(),
    selResv: null,
    modal: null,
    form: {},
    formErr: "",
    payDraft: null,
    payResult: null,
    processing: false,
    custQuery: "",
    custDetailId: null,
    salesPeriod: "month",
    invTab: "stock",
    invQuery: "",
    invOnlyLow: false,
    mobileNav: false,
    inventoryBusy: false,
    inventoryPickerOpen: false,
    discardConfirm: false,
    toast: "",
    resetArmed: false,
    schedDate: this.today(),
    saveErr: false,
  };
  componentDidMount() {
    this.applyVars();
    try {
      this._persistedRaw = localStorage.getItem("salon-erp-prototype-v2");
      if (this._persistedRaw) {
        const saved = JSON.parse(this._persistedRaw);
        if (!saved || !saved.data || !Array.isArray(saved.data.resv))
          throw new Error("Invalid saved data");
        this.setState({ data: window.SalonInventory.normalize(saved.data) });
      }
    } catch (e) {
      this._loadBlocked = true;
      this.setState({ saveErr: true });
      this.notify(
        "저장된 데이터를 읽지 못했습니다. 기존 기록을 보호하기 위해 저장을 중지했습니다.",
      );
    }
    this._onKeydown = (e) => this.inventoryKeydown(e);
    document.addEventListener("keydown", this._onKeydown);
    this._onStorage = (e) => {
      if (
        e.key !== "salon-erp-prototype-v2" ||
        !e.newValue ||
        this.state.modal ||
        this.state.payDraft
      )
        return;
      try {
        const saved = JSON.parse(e.newValue);
        const data = window.SalonInventory.normalize(saved.data);
        this._persistedRaw = e.newValue;
        this.setState({ data });
      } catch (_) {}
    };
    window.addEventListener("storage", this._onStorage);
  }
  componentDidUpdate() {
    this.applyVars();
    this.updateDialogFocus();
  }
  componentWillUnmount() {
    clearTimeout(this._tt);
    clearTimeout(this._pt);
    document.removeEventListener("keydown", this._onKeydown);
    window.removeEventListener("storage", this._onStorage);
    if (this._dialogOpen)
      document.body.style.overflow = this._bodyOverflow || "";
  }
  applyVars() {
    const p = this.props || {};
    const pal =
      Array.isArray(p.mainColor) && p.mainColor.length
        ? p.mainColor
        : ["#1E4B8F", "#EAF1FA"];
    const s = document.documentElement.style;
    s.setProperty("--main", pal[0]);
    s.setProperty("--tint", pal[1] || "#EEF1F5");
  }
  ymd(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  today() {
    return this.ymd(new Date());
  }
  dayStr(off) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + off);
    return this.ymd(d);
  }
  hm(m) {
    return (
      String(Math.floor(m / 60)).padStart(2, "0") +
      ":" +
      String(m % 60).padStart(2, "0")
    );
  }
  nowHM() {
    const d = new Date();
    return this.hm(d.getHours() * 60 + d.getMinutes());
  }
  md(s) {
    const p = String(s).split("-");
    return +p[1] + "월 " + +p[2] + "일";
  }
  nowSlot() {
    const d = new Date();
    const m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 30) * 30;
    return Math.min(Math.max(m, 600), 1170);
  }
  clone(o) {
    return JSON.parse(JSON.stringify(o));
  }
  digits(p) {
    return String(p || "").replace(/\D/g, "");
  }
  validPhone(p) {
    return /^01\d{8,9}$/.test(this.digits(p));
  }
  fmtPhone(p) {
    const x = this.digits(p);
    return x.length === 11
      ? x.slice(0, 3) + "-" + x.slice(3, 7) + "-" + x.slice(7)
      : x.slice(0, 3) + "-" + x.slice(3, 6) + "-" + x.slice(6);
  }
  stockSt(i) {
    return window.SalonInventory.stockStatus(i);
  }
  badge(t) {
    const M = "var(--main, #1E4B8F)",
      T = "var(--tint, #EAF1FA)";
    const G = ["#F3F4F6", "#444444"],
      OK = ["#E9F5EC", "#2B8A3E"],
      BAD = ["#FDECEC", "#C92A2A"],
      BL = [T, M];
    const map = {
      정상: OK,
      "보충 필요": BAD,
      품절: ["#C92A2A", "#FFFFFF"],
      "발주 중": BL,
      "입고 완료": G,
      예약: BL,
      "시술 중": [M, "#FFFFFF"],
      완료: G,
      취소: ["#F3F4F6", "#5F6368"],
      노쇼: BAD,
      신규: BL,
      재방문: OK,
      미등록: G,
      재직: OK,
      휴직: G,
      입고: OK,
      "시술 사용": G,
      "상품 판매": BL,
      "재고 조정": G,
      "반품 입고": OK,
      "결제 완료": OK,
      "결제 취소": BAD,
    };
    const c = map[t] || G;
    return { t, bg: c[0], fg: c[1] };
  }
  allocate(prices, disc) {
    const sum = prices.reduce((a, b) => a + b, 0);
    if (!sum || !disc) return prices.map(() => 0);
    const a = prices.map((p) => Math.round((disc * p) / sum));
    const diff = disc - a.reduce((x, y) => x + y, 0);
    if (diff) {
      let mi = 0;
      prices.forEach((p, i) => {
        if (p > prices[mi]) mi = i;
      });
      a[mi] += diff;
    }
    return a;
  }
  seed() {
    const ds = (o) => this.dayStr(o);
    const staff = [
      {
        id: "s1",
        name: "김민지",
        role: "원장",
        phone: "010-3312-4587",
        status: "재직",
      },
      {
        id: "s2",
        name: "박서연",
        role: "디자이너",
        phone: "010-5521-9034",
        status: "재직",
      },
      {
        id: "s3",
        name: "이도윤",
        role: "디자이너",
        phone: "010-7745-2210",
        status: "재직",
      },
      {
        id: "s4",
        name: "정유나",
        role: "스태프",
        phone: "010-2298-6671",
        status: "재직",
      },
    ];
    const items = [
      {
        id: "i1",
        name: "염색 약제",
        kind: "시술 재료",
        unit: "g",
        qty: 200,
        min: 150,
        price: 0,
      },
      {
        id: "i2",
        name: "펌 약제",
        kind: "시술 재료",
        unit: "ml",
        qty: 900,
        min: 300,
        price: 0,
      },
      {
        id: "i3",
        name: "클리닉 약제",
        kind: "시술 재료",
        unit: "ml",
        qty: 400,
        min: 150,
        price: 0,
      },
      {
        id: "i4",
        name: "헤어 에센스",
        kind: "판매 상품",
        unit: "개",
        qty: 8,
        min: 3,
        price: 25000,
      },
      {
        id: "i5",
        name: "샴푸",
        kind: "판매 상품",
        unit: "개",
        qty: 2,
        min: 3,
        price: 18000,
      },
      {
        id: "i6",
        name: "헤어 왁스",
        kind: "판매 상품",
        unit: "개",
        qty: 0,
        min: 2,
        price: 15000,
      },
    ];
    const services = [
      { id: "v1", name: "커트", price: 20000, dur: 30, mats: [] },
      {
        id: "v2",
        name: "기본 염색",
        price: 80000,
        dur: 90,
        mats: [{ itemId: "i1", amt: 60 }],
      },
      {
        id: "v3",
        name: "뿌리 염색",
        price: 50000,
        dur: 60,
        mats: [{ itemId: "i1", amt: 30 }],
      },
      {
        id: "v4",
        name: "일반 펌",
        price: 90000,
        dur: 120,
        mats: [{ itemId: "i2", amt: 100 }],
      },
      {
        id: "v5",
        name: "클리닉",
        price: 40000,
        dur: 30,
        mats: [{ itemId: "i3", amt: 30 }],
      },
      { id: "v6", name: "드라이", price: 15000, dur: 30, mats: [] },
    ];
    const customers = [
      {
        id: "c1",
        name: "한지원",
        phone: "010-2345-6789",
        memo: "두피가 예민해 저자극 약제 사용",
        since: ds(-120),
      },
      {
        id: "c2",
        name: "윤태오",
        phone: "010-4821-3307",
        memo: "",
        since: ds(-60),
      },
      {
        id: "c3",
        name: "강다은",
        phone: "010-9173-5512",
        memo: "펌 컬은 굵게 선호",
        since: ds(-90),
      },
      {
        id: "c4",
        name: "서민재",
        phone: "010-6630-2284",
        memo: "",
        since: ds(-45),
      },
      {
        id: "c5",
        name: "임하린",
        phone: "010-3058-7741",
        memo: "",
        since: ds(-30),
      },
      {
        id: "c6",
        name: "문지호",
        phone: "010-8812-4406",
        memo: "",
        since: ds(-5),
      },
    ];
    const spec = [
      [-20, "11:00", "c1", "s2", ["v2", "v1"], [], 0, "카드"],
      [-18, "14:00", "c2", "s3", ["v1"], [], 0, "현금"],
      [-16, "15:30", null, "s1", ["v1", "v6"], [], 0, "카드"],
      [-15, "13:00", "c3", "s1", ["v4"], [], 5000, "카드"],
      [-13, "16:00", "c4", "s2", ["v5"], ["i4"], 0, "계좌이체"],
      [-11, "10:30", "c5", "s3", ["v3"], [], 0, "카드"],
      [-9, "12:00", "c2", "s3", ["v1"], [], 0, "카드"],
      [-8, "17:00", null, "s2", ["v6"], [], 0, "현금"],
      [-6, "11:30", "c3", "s1", ["v5"], [], 0, "카드"],
      [-5, "14:30", "c6", "s2", ["v2"], [], 8000, "카드"],
      [-3, "15:00", "c4", "s3", ["v1"], ["i5"], 0, "카드"],
      [-2, "18:00", null, "s1", ["v1"], [], 0, "현금"],
      [-1, "13:30", "c5", "s2", ["v1", "v5"], [], 6000, "카드"],
      [0, "10:30", "c6", "s1", ["v1"], [], 0, "카드"],
    ];
    const txns = [];
    spec.forEach((x, n) => {
      const lines = x[4]
        .map((id) => {
          const v = services.find((s) => s.id === id);
          return { type: "service", refId: id, name: v.name, price: v.price };
        })
        .concat(
          x[5].map((id) => {
            const it = items.find((i) => i.id === id);
            return {
              type: "product",
              refId: id,
              name: it.name,
              price: it.price,
            };
          }),
        );
      const sub = lines.reduce((a, l) => a + l.price, 0),
        al = this.allocate(
          lines.map((l) => l.price),
          x[6],
        );
      const cid = x[2],
        prior = cid ? txns.filter((t) => t.customerId === cid).length : 0;
      txns.push({
        id: "T" + String(n + 1).padStart(4, "0"),
        date: ds(x[0]),
        time: x[1],
        resvId: x[0] === 0 ? "r0" : null,
        customerId: cid,
        customerName: cid ? customers.find((c) => c.id === cid).name : "비회원",
        custType: cid ? (prior ? "재방문" : "신규") : "미등록",
        staffId: x[3],
        items: lines.map((l, i) =>
          Object.assign({}, l, { alloc: al[i], net: l.price - al[i] }),
        ),
        subtotal: sub,
        discount: x[6],
        total: sub - x[6],
        method: x[7],
        status: "완료",
      });
    });
    const orders = [
      {
        id: "O0001",
        itemId: "i2",
        qty: 1000,
        date: ds(-19),
        status: "입고 완료",
        recvDate: ds(-17),
        memo: "정기 발주",
      },
      {
        id: "O0002",
        itemId: "i5",
        qty: 10,
        date: ds(-1),
        status: "발주 중",
        recvDate: "",
        memo: "",
      },
    ];
    const ev = [];
    txns.forEach((t) =>
      t.items.forEach((l) => {
        if (l.type === "service")
          services
            .find((s) => s.id === l.refId)
            .mats.forEach((m) =>
              ev.push({
                dt: t.date + " " + t.time,
                itemId: m.itemId,
                delta: -m.amt,
                kind: "시술 사용",
                ref: t.id,
              }),
            );
        else
          ev.push({
            dt: t.date + " " + t.time,
            itemId: l.refId,
            delta: -1,
            kind: "상품 판매",
            ref: t.id,
          });
      }),
    );
    orders
      .filter((o) => o.status === "입고 완료")
      .forEach((o) =>
        ev.push({
          dt: o.recvDate + " 11:00",
          itemId: o.itemId,
          delta: o.qty,
          kind: "입고",
          ref: o.id,
        }),
      );
    ev.sort((a, b) => (a.dt < b.dt ? -1 : a.dt > b.dt ? 1 : 0));
    const cur = {};
    items.forEach((i) => {
      cur[i.id] = i.qty;
    });
    for (let k = ev.length - 1; k >= 0; k--) {
      ev[k].after = cur[ev[k].itemId];
      cur[ev[k].itemId] -= ev[k].delta;
    }
    const logs = ev.map((e, k) => Object.assign({ id: "L" + (k + 1) }, e));
    const T = ds(0);
    const R = (id, start, custId, guest, staffId, svc, status, memo) => ({
      id,
      date: T,
      start,
      dur: svc.reduce((a, v) => a + services.find((s) => s.id === v).dur, 0),
      custId,
      guest,
      phone: "",
      staffId,
      svc,
      status,
      src: "예약",
      txnId: null,
      memo: memo || "",
    });
    const resv = [
      R("r0", 600, "c6", "", "s1", ["v1"], "완료"),
      R("r1", 600, "c1", "", "s2", ["v2", "v1"], "예약", "저자극 약제 확인"),
      R("r2", 660, "c2", "", "s3", ["v1"], "예약"),
      R("r3", 780, "c3", "", "s1", ["v4"], "예약"),
      R("r4", 870, "c4", "", "s2", ["v5"], "예약"),
      R("r5", 960, "c5", "", "s3", ["v3"], "예약"),
      R("r6", 1080, null, "최지아", "s1", ["v6"], "예약"),
    ];
    resv[0].txnId = "T0014";
    const T1 = ds(1);
    resv.push(
      Object.assign(R("r7", 660, "c4", "", "s3", ["v1"], "예약"), { date: T1 }),
    );
    resv.push(
      Object.assign(
        R("r8", 900, "c5", "", "s2", ["v5"], "예약", "지난번 클리닉 만족"),
        { date: T1 },
      ),
    );
    return window.SalonInventory.normalize({
      store: { name: "봄 헤어", open: 600, close: 1200 },
      staff,
      items,
      services,
      customers,
      txns,
      orders,
      logs,
      resv,
      seq: { t: txns.length + 1, o: 3, r: 9, c: 7, s: 5, l: logs.length + 1 },
    });
  }
  commit(data, extra) {
    if (this._loadBlocked) {
      this.setState({
        formErr: "저장된 데이터 복구가 필요합니다. 기존 기록을 확인해 주세요.",
        processing: false,
      });
      return false;
    }
    try {
      const current = localStorage.getItem("salon-erp-prototype-v2");
      if (current !== this._persistedRaw) {
        if (current) {
          const saved = JSON.parse(current);
          this.setState({
            data: window.SalonInventory.normalize(saved.data),
            formErr:
              "다른 창에서 변경한 내용을 불러왔습니다. 수량을 확인한 후 다시 저장해 주세요.",
            processing: false,
          });
          this._persistedRaw = current;
        } else {
          this.setState({
            formErr:
              "다른 창에서 저장된 기록이 변경되었습니다. 새로고침 후 확인해 주세요.",
            processing: false,
          });
        }
        this.notify(
          "다른 창의 변경 내용과 충돌했습니다. 내용을 확인해 주세요.",
        );
        return false;
      }
      const raw = JSON.stringify({ savedAt: new Date().toISOString(), data });
      localStorage.setItem("salon-erp-prototype-v2", raw);
      this._persistedRaw = raw;
    } catch (e) {
      this.setState({
        saveErr: true,
        formErr:
          "저장하지 못했습니다. 입력은 유지됩니다. 저장 공간을 확인하고 다시 저장해 주세요.",
        processing: false,
      });
      this.notify(
        "저장에 실패했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요.",
      );
      return false;
    }
    this.setState(Object.assign({ data, saveErr: false }, extra || {}));
    return true;
  }
  notify(msg) {
    clearTimeout(this._tt);
    this.setState({ toast: msg });
    this._tt = setTimeout(() => this.setState({ toast: "" }), 3200);
  }
  scrollTop() {
    try {
      window.scrollTo(0, 0);
    } catch (e) {}
  }
  go(page, extra) {
    this.setState(
      Object.assign(
        {
          page,
          mobileNav: false,
          selResv: null,
          modal: null,
          resetArmed: false,
          payResult: null,
          custDetailId: null,
        },
        extra || {},
      ),
    );
    this.scrollTop();
  }
  openModal(type, p) {
    if (
      [
        "receipt",
        "receiptEdit",
        "receiptCancel",
        "threshold",
        "adjust",
        "order",
      ].includes(type)
    ) {
      this.inventoryModal(type === "order" ? "receipt" : type, p);
      return;
    }
    p = p || {};
    const D = this.state.data;
    let form = {};
    if (type === "resv" || type === "walkin") {
      const des = D.staff.filter(
        (s) => s.status === "재직" && s.role !== "스태프",
      );
      const sd =
        this.state.schedDate < this.today()
          ? this.today()
          : this.state.schedDate;
      form = {
        mode: type,
        ckind: "reg",
        custId: null,
        q: "",
        name: "",
        phone: "",
        svc: [],
        staffId: p.staffId || (des[0] ? des[0].id : null),
        date: type === "walkin" ? this.today() : p.date || sd,
        start:
          p.start != null
            ? p.start
            : type === "walkin"
              ? this.nowSlot()
              : D.store.open,
        memo: "",
      };
    } else if (type === "edit") {
      const r = D.resv.find((x) => x.id === p.resvId);
      if (!r) return;
      form = {
        mode: "edit",
        resvId: r.id,
        ckind: r.custId ? "reg" : "guest",
        custId: r.custId,
        q: "",
        name: r.guest || "",
        phone: r.phone || "",
        svc: r.svc.slice(),
        staffId: r.staffId,
        date: r.date,
        start: r.start,
        memo: r.memo || "",
      };
    } else if (type === "customer") {
      const c = p.custId ? D.customers.find((x) => x.id === p.custId) : null;
      form = {
        custId: c ? c.id : null,
        name: c ? c.name : "",
        phone: c ? c.phone : "",
        memo: c ? c.memo : "",
      };
    } else if (type === "staff")
      form = { name: "", role: "디자이너", phone: "" };
    else if (type === "order") {
      const it = p.itemId ? D.items.find((i) => i.id === p.itemId) : null;
      form = {
        itemId: it ? it.id : null,
        qty: it ? (it.kind === "시술 재료" ? "500" : "10") : "",
        memo: "",
      };
    } else if (type === "adjust") {
      const it = D.items.find((i) => i.id === p.itemId);
      form = { itemId: p.itemId, qty: String(it ? it.qty : 0), reason: "" };
    } else if (type === "txn")
      form = {
        txnId: p.txnId,
        cancelOpen: false,
        reason: "",
        cmode: "redo",
        restock: false,
      };
    this._formSnapshot = JSON.stringify(form);
    this._returnFocus = document.activeElement;
    this.setState({ modal: type, form, formErr: "", discardConfirm: false });
  }
  setForm(patch) {
    this.setState((s) => ({
      form: Object.assign({}, s.form, patch),
      formErr: "",
      discardConfirm: false,
    }));
  }
  toggleSvc(id) {
    const s = this.state.form.svc || [];
    this.setForm({
      svc: s.indexOf(id) >= 0 ? s.filter((x) => x !== id) : s.concat([id]),
    });
  }
  conflict(D, date, staffId, start, dur, exceptId) {
    const today = this.today();
    return D.resv.find(
      (r) =>
        r.id !== exceptId &&
        r.date === date &&
        r.staffId === staffId &&
        r.status !== "취소" &&
        r.status !== "노쇼" &&
        start < r.start + r.dur &&
        r.start < start + dur,
    );
  }
  isFree(D, date, staffId, start, dur, exceptId) {
    return (
      start >= D.store.open &&
      start + dur <= D.store.close &&
      !this.conflict(D, date, staffId, start, dur, exceptId || null)
    );
  }
  saveResv() {
    const S = this.state,
      D = S.data,
      f = S.form;
    const name = (f.name || "").trim();
    const dur = (f.svc || []).reduce((a, id) => {
      const v = D.services.find((x) => x.id === id);
      return a + (v ? v.dur : 0);
    }, 0);
    let err = "";
    if (f.ckind === "reg" && !f.custId)
      err = "등록 고객을 검색해서 선택해 주세요.";
    else if (f.ckind === "new" && !name) err = "고객 이름을 입력해 주세요.";
    else if (f.ckind === "new" && !this.validPhone(f.phone))
      err = "연락처를 010-0000-0000 형식으로 입력해 주세요.";
    else if (
      f.ckind === "new" &&
      D.customers.some((c) => this.digits(c.phone) === this.digits(f.phone))
    )
      err = "이미 등록된 연락처입니다. ‘등록 고객’에서 선택해 주세요.";
    else if (f.ckind === "guest" && !name) err = "비회원 이름을 입력해 주세요.";
    else if (!dur) err = "시술을 하나 이상 선택해 주세요.";
    else if (!f.staffId) err = "담당 디자이너를 선택해 주세요.";
    else if (!f.date) err = "예약 날짜를 선택해 주세요.";
    else if (f.date < this.today())
      err = "지난 날짜에는 예약을 등록할 수 없습니다.";
    else if (f.start + dur > D.store.close)
      err =
        "영업 종료(" +
        this.hm(D.store.close) +
        ") 전에 끝나도록 시간을 선택해 주세요.";
    else {
      const c = this.conflict(
        D,
        f.date,
        f.staffId,
        f.start,
        dur,
        f.mode === "edit" ? f.resvId : null,
      );
      if (c) {
        const st = D.staff.find((s) => s.id === f.staffId) || { name: "" };
        const cn = c.custId
          ? (D.customers.find((x) => x.id === c.custId) || {}).name
          : c.guest;
        err =
          st.name +
          " 디자이너는 " +
          this.hm(c.start) +
          "–" +
          this.hm(c.start + c.dur) +
          "에 " +
          cn +
          " 고객 예약이 있습니다.";
      }
    }
    if (err) {
      this.setState({ formErr: err });
      return;
    }
    const d = this.clone(D),
      walk = f.mode === "walkin";
    if (f.mode === "edit") {
      const r = d.resv.find((x) => x.id === f.resvId);
      if (!r || r.txnId) {
        this.setState({ modal: null });
        return;
      }
      const stN = (id) => (d.staff.find((s) => s.id === id) || {}).name || "";
      const bef =
          this.md(r.date) + " " + this.hm(r.start) + " " + stN(r.staffId),
        aft = this.md(f.date) + " " + this.hm(f.start) + " " + stN(f.staffId);
      r.changes = (r.changes || []).concat([
        {
          at: this.md(this.today()) + " " + this.nowHM(),
          text: bef === aft ? "시술·메모 변경" : bef + " → " + aft,
        },
      ]);
      Object.assign(r, {
        date: f.date,
        start: f.start,
        dur,
        staffId: f.staffId,
        svc: f.svc.slice(),
        memo: (f.memo || "").trim(),
      });
      if (
        !this.commit(d, {
          modal: null,
          formErr: "",
          page: "schedule",
          schedDate: f.date,
          selResv: r.id,
        })
      )
        return;
      this.notify("예약을 변경했습니다 · " + aft);
      return;
    }
    let custId = f.ckind === "reg" ? f.custId : null;
    if (f.ckind === "new") {
      custId = "c" + d.seq.c++;
      d.customers.push({
        id: custId,
        name,
        phone: this.fmtPhone(f.phone),
        memo: "",
        since: this.today(),
      });
    }
    const id = "r" + d.seq.r++;
    d.resv.push({
      id,
      date: walk ? this.today() : f.date,
      start: f.start,
      dur,
      custId,
      guest: f.ckind === "guest" ? name : "",
      phone: f.ckind === "guest" ? (f.phone || "").trim() : "",
      staffId: f.staffId,
      svc: f.svc.slice(),
      status: walk ? "시술 중" : "예약",
      src: walk ? "현장 접수" : "예약",
      txnId: null,
      memo: (f.memo || "").trim(),
      changes: [],
    });
    if (
      !this.commit(d, {
        modal: null,
        formErr: "",
        page: "schedule",
        schedDate: walk ? this.today() : f.date,
        selResv: id,
      })
    )
      return;
    this.notify(
      walk
        ? "현장 접수를 등록했습니다. 시술 후 결제를 진행하세요."
        : "예약을 등록했습니다 · " + this.md(f.date) + " " + this.hm(f.start),
    );
  }
  setResvStatus(id, st) {
    const d = this.clone(this.state.data),
      r = d.resv.find((x) => x.id === id);
    if (!r || r.txnId) return;
    r.status = st;
    if (!this.commit(d)) return;
    this.notify(
      st === "시술 중"
        ? "방문을 확인했습니다. 시술 후 결제를 진행하세요."
        : st === "취소"
          ? "예약을 취소했습니다. 매출·이력·재고에는 반영되지 않습니다."
          : "노쇼로 처리했습니다. 매출·이력·재고에는 반영되지 않습니다.",
    );
  }
  startPay(id) {
    const D = this.state.data,
      r = D.resv.find((x) => x.id === id);
    if (!r || r.txnId) return;
    const lines = r.svc.map((sid) => {
      const v = D.services.find((x) => x.id === sid);
      this._k = (this._k || 0) + 1;
      return {
        key: "k" + this._k,
        type: "service",
        refId: sid,
        name: v.name,
        price: v.price,
      };
    });
    this.setState({
      page: "payment",
      payDraft: {
        resvId: id,
        staffId: r.staffId,
        lines,
        discount: "",
        method: "카드",
        shortReason: "",
      },
      payResult: null,
      selResv: null,
      modal: null,
      processing: false,
    });
    this.scrollTop();
  }
  updDraft(patch) {
    this.setState((s) => ({ payDraft: Object.assign({}, s.payDraft, patch) }));
  }
  addLine(type, refId) {
    const D = this.state.data,
      src =
        type === "service"
          ? D.services.find((x) => x.id === refId)
          : D.items.find((x) => x.id === refId);
    if (!src || !this.state.payDraft) return;
    this._k = (this._k || 0) + 1;
    const line = {
      key: "k" + this._k,
      type,
      refId,
      name: src.name,
      price: src.price,
    };
    this.setState((s) => ({
      payDraft: Object.assign({}, s.payDraft, {
        lines: s.payDraft.lines.concat([line]),
      }),
    }));
  }
  removeLine(key) {
    this.setState((s) => ({
      payDraft: Object.assign({}, s.payDraft, {
        lines: s.payDraft.lines.filter((l) => l.key !== key),
      }),
    }));
  }
  payCalc(dr) {
    const sub = dr.lines.reduce((a, l) => a + l.price, 0);
    const disc = parseInt(dr.discount || "0", 10) || 0;
    let err = "";
    if (!dr.lines.length) err = "시술 또는 상품을 하나 이상 추가해 주세요.";
    else if (disc > sub) err = "할인 금액이 합계보다 클 수 없습니다.";
    const d = err ? 0 : disc;
    return {
      sub,
      disc: d,
      total: sub - d,
      alloc: this.allocate(
        dr.lines.map((l) => l.price),
        d,
      ),
      err,
    };
  }
  payNeed(D, lines) {
    const need = {};
    lines.forEach((l) => {
      if (l.type === "service") {
        const v = D.services.find((x) => x.id === l.refId);
        (v ? v.mats : []).forEach((m) => {
          need[m.itemId] = (need[m.itemId] || 0) + m.amt;
        });
      } else need[l.refId] = (need[l.refId] || 0) + 1;
    });
    return need;
  }
  submitPay() {
    const S = this.state,
      dr = S.payDraft;
    if (!dr || S.processing) return;
    const r0 = S.data.resv.find((x) => x.id === dr.resvId);
    if (!r0 || r0.txnId) {
      this.notify(
        "이미 결제가 완료된 예약입니다. 같은 거래는 한 번만 저장됩니다.",
      );
      return;
    }
    if (this.payCalc(dr).err) return;
    if (this.payShort(S.data, dr).length && !(dr.shortReason || "").trim()) {
      this.notify(
        "재고가 부족합니다. 재고를 조정하거나 부족 사유를 입력해 주세요.",
      );
      return;
    }
    this.setState({ processing: true });
    this._pt = setTimeout(() => {
      try {
        const D = this.state.data,
          dr2 = this.state.payDraft;
        const r1 = dr2 ? D.resv.find((x) => x.id === dr2.resvId) : null;
        if (!r1 || r1.txnId) {
          this.setState({ processing: false });
          return;
        }
        const calc = this.payCalc(dr2),
          d = this.clone(D),
          today = this.today(),
          time = this.nowHM();
        const r = d.resv.find((x) => x.id === dr2.resvId);
        const cust = r.custId
          ? d.customers.find((c) => c.id === r.custId)
          : null;
        const prior = cust
          ? d.txns.filter(
              (t) => t.customerId === cust.id && t.status !== "취소",
            ).length
          : 0;
        const ctype = cust ? (prior ? "재방문" : "신규") : "미등록";
        const id = "T" + String(d.seq.t++).padStart(4, "0");
        const items = dr2.lines.map((l, i) => ({
          type: l.type,
          refId: l.refId,
          name: l.name,
          price: l.price,
          alloc: calc.alloc[i],
          net: l.price - calc.alloc[i],
        }));
        const cname = cust ? cust.name : r.guest || "비회원";
        d.txns.push({
          id,
          date: today,
          time,
          resvId: r.id,
          customerId: cust ? cust.id : null,
          customerName: cname,
          custType: ctype,
          staffId: dr2.staffId,
          items,
          subtotal: calc.sub,
          discount: calc.disc,
          total: calc.total,
          method: dr2.method,
          status: "완료",
        });
        const before = r.status;
        r.status = "완료";
        r.txnId = id;
        const need = this.payNeed(d, dr2.lines),
          stock = [];
        Object.keys(need).forEach((iid) => {
          const it = d.items.find((x) => x.id === iid);
          if (!it) return;
          const b = it.qty,
            short = Math.max(0, need[iid] - b);
          it.qty = Math.max(0, b - need[iid]);
          d.logs.push({
            id: "L" + d.seq.l++,
            dt: today + " " + time,
            itemId: iid,
            delta: it.qty - b,
            kind: it.kind === "판매 상품" ? "상품 판매" : "시술 사용",
            after: it.qty,
            ref: short
              ? id +
                " · 부족 " +
                short +
                it.unit +
                " (" +
                (dr2.shortReason || "").trim() +
                ")"
              : id,
          });
          stock.push({
            name: it.name,
            from: b + it.unit,
            to:
              it.qty +
              it.unit +
              (short ? " (부족 " + short + it.unit + ", 사유 기록)" : ""),
            st: this.stockSt(it),
          });
        });
        const staff = d.staff.find((s) => s.id === dr2.staffId) || {
          name: "-",
        };
        const staffToday = d.txns
          .filter(
            (t) =>
              t.date === today &&
              t.staffId === dr2.staffId &&
              t.status !== "취소",
          )
          .reduce((a, t) => a + t.total, 0);
        const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
        const rows = [
          {
            label: "예약·일정",
            value: this.hm(r.start) + " 예약 · 상태 " + before + " → 완료",
            badge: null,
          },
          {
            label: "매출 내역",
            value: id + " · " + won(calc.total) + " 거래 생성",
            badge: null,
          },
          {
            label: "고객 시술 이력",
            value: cust
              ? cname +
                " 님 이력에 " +
                items.map((x) => x.name).join(" · ") +
                " 추가"
              : "비회원 — 고객 목록에는 저장하지 않음",
            badge: this.badge(ctype),
          },
          {
            label: "디자이너 실적",
            value:
              staff.name +
              " +" +
              won(calc.total) +
              " (오늘 누적 " +
              won(staffToday) +
              ")",
            badge: null,
          },
        ].concat(
          stock.map((s) => ({
            label: "재고 차감",
            value: s.name + " " + s.from + " → " + s.to,
            badge: this.badge(s.st),
          })),
        );
        if (
          !this.commit(d, {
            processing: false,
            payDraft: null,
            payResult: {
              id,
              total: calc.total,
              cust: cname,
              rows,
              hasLow: stock.some((s) => s.st !== "정상"),
            },
          })
        )
          return;
        this.scrollTop();
      } catch (e) {
        this.setState({ processing: false });
        this.notify(
          "결제 처리 중 오류가 발생해 아무것도 반영하지 않았습니다. 다시 시도해 주세요.",
        );
      }
    }, 700);
  }
  payShort(D, dr) {
    const need = this.payNeed(D, dr.lines);
    return Object.keys(need)
      .map((id) => {
        const it = D.items.find((x) => x.id === id);
        return it && need[id] > it.qty
          ? { id, name: it.name, unit: it.unit, short: need[id] - it.qty }
          : null;
      })
      .filter(Boolean);
  }
  cancelTxn() {
    const f = this.state.form,
      D = this.state.data,
      t0 = D.txns.find((x) => x.id === f.txnId);
    if (!t0 || t0.status === "취소") {
      this.setState({ modal: null });
      return;
    }
    if (!(f.reason || "").trim()) {
      this.setState({ formErr: "취소 사유를 입력해 주세요." });
      return;
    }
    const d = this.clone(D),
      t = d.txns.find((x) => x.id === f.txnId),
      now = this.today() + " " + this.nowHM();
    t.status = "취소";
    t.cancel = {
      dt: now,
      reason: f.reason.trim(),
      mode: f.cmode,
      restock: !!f.restock,
    };
    const r = t.resvId ? d.resv.find((x) => x.id === t.resvId) : null,
      redo = f.cmode === "redo" && !!r;
    if (redo) {
      r.status = "시술 중";
      r.txnId = null;
      r.changes = (r.changes || []).concat([
        {
          at: this.md(this.today()) + " " + this.nowHM(),
          text: t.id + " 결제 취소 · 다시 기록 대기",
        },
      ]);
    }
    if (f.restock)
      t.items
        .filter((l) => l.type === "product")
        .forEach((l) => {
          const it = d.items.find((i) => i.id === l.refId);
          if (!it) return;
          it.qty += 1;
          d.logs.push({
            id: "L" + d.seq.l++,
            dt: now,
            itemId: it.id,
            delta: 1,
            kind: "반품 입고",
            after: it.qty,
            ref: t.id + " 취소",
          });
        });
    if (!this.commit(d, { modal: null, formErr: "" })) return;
    this.notify(
      t.id +
        " 거래를 취소했습니다. " +
        (redo
          ? "예약이 결제 대기로 돌아갔으니 올바른 내용으로 다시 기록하세요."
          : "원거래 기록은 남고 매출 합계에서 제외됩니다."),
    );
  }
  setSchedDate(v) {
    if (v) this.setState({ schedDate: v, selResv: null });
  }
  shiftSched(n) {
    const d = new Date(this.state.schedDate + "T12:00:00");
    d.setDate(d.getDate() + n);
    this.setSchedDate(this.ymd(d));
  }
  saveCust() {
    const S = this.state,
      f = S.form,
      D = S.data;
    const name = (f.name || "").trim(),
      phone = (f.phone || "").trim();
    let err = "";
    if (!name) err = "이름을 입력해 주세요.";
    else if (!this.validPhone(phone))
      err = "연락처를 010-0000-0000 형식으로 입력해 주세요.";
    else if (
      D.customers.some(
        (c) => c.id !== f.custId && this.digits(c.phone) === this.digits(phone),
      )
    )
      err = "이미 등록된 연락처입니다.";
    if (err) {
      this.setState({ formErr: err });
      return;
    }
    const d = this.clone(D);
    if (f.custId) {
      const c = d.customers.find((x) => x.id === f.custId);
      c.name = name;
      c.phone = this.fmtPhone(phone);
      c.memo = (f.memo || "").trim();
      d.txns.forEach((t) => {
        if (t.customerId === c.id) t.customerName = name;
      });
    } else
      d.customers.push({
        id: "c" + d.seq.c++,
        name,
        phone: this.fmtPhone(phone),
        memo: (f.memo || "").trim(),
        since: this.today(),
      });
    if (!this.commit(d, { modal: null })) return;
    this.notify(
      f.custId ? "고객 정보를 수정했습니다." : "고객을 등록했습니다 · " + name,
    );
  }
  saveStaff() {
    const f = this.state.form,
      name = (f.name || "").trim();
    let err = "";
    if (!name) err = "이름을 입력해 주세요.";
    else if (!this.validPhone(f.phone))
      err = "연락처를 010-0000-0000 형식으로 입력해 주세요.";
    if (err) {
      this.setState({ formErr: err });
      return;
    }
    const d = this.clone(this.state.data);
    d.staff.push({
      id: "s" + d.seq.s++,
      name,
      role: f.role || "디자이너",
      phone: this.fmtPhone(f.phone),
      status: "재직",
    });
    if (!this.commit(d, { modal: null })) return;
    this.notify("직원을 등록했습니다 · " + name);
  }
  toggleStaff(id) {
    const D = this.state.data,
      today = this.today(),
      s = D.staff.find((x) => x.id === id);
    if (!s) return;
    if (
      s.status === "재직" &&
      D.resv.some(
        (r) =>
          r.date === today &&
          r.staffId === id &&
          (r.status === "예약" || r.status === "시술 중"),
      )
    ) {
      this.notify("오늘 남은 예약이 있어 휴직 처리할 수 없습니다.");
      return;
    }
    const d = this.clone(D),
      t = d.staff.find((x) => x.id === id);
    t.status = t.status === "재직" ? "휴직" : "재직";
    if (!this.commit(d)) return;
    this.notify(t.name + " · " + t.status + " 상태로 변경했습니다.");
  }
  inventoryContext() {
    const actor = this.state.data.staff.find((s) => s.id === "s1") || {
      id: "s1",
      name: "김민지",
    };
    return {
      today: this.today(),
      at: new Date().toISOString(),
      actorId: actor.id,
      actorName: actor.name,
    };
  }
  inventoryToken() {
    return typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  inventoryModal(type, p) {
    const D = this.state.data;
    p = p || {};
    const receipt = p.receiptId
      ? D.receipts.find((r) => r.id === p.receiptId)
      : null;
    const itemId = receipt ? receipt.itemId : p.itemId || "";
    const item = D.items.find((i) => i.id === itemId);
    if (type !== "receipt" && !item) {
      this.notify("품목을 찾을 수 없습니다.");
      return;
    }
    const form = {
      itemId,
      qty:
        type === "threshold"
          ? String(item.min)
          : type === "adjust"
            ? String(item.qty)
            : receipt
              ? String(receipt.qty)
              : "",
      date: this.today(),
      memo: "",
      reason: "",
      token: this.inventoryToken(),
    };
    if (receipt)
      Object.assign(form, {
        receiptId: receipt.id,
        expectedRevision: receipt.revision,
      });
    this._formSnapshot = JSON.stringify(form);
    this._returnFocus = document.activeElement;
    this.setState({
      modal: type,
      form,
      formErr: "",
      discardConfirm: false,
      inventoryBusy: false,
      inventoryPickerOpen: type === "receipt" && !itemId,
    });
  }
  saveInventory() {
    if (this._inventorySaving) return;
    const actions = {
      receipt: "addReceipt",
      receiptEdit: "correctReceipt",
      receiptCancel: "cancelReceipt",
      threshold: "setThreshold",
      adjust: "adjustStock",
    };
    const type = this.state.modal,
      action = actions[type];
    if (!action) return;
    this._inventorySaving = true;
    this.setState({ inventoryBusy: true, formErr: "" });
    try {
      const d = window.SalonInventory[action](
        this.state.data,
        this.state.form,
        this.inventoryContext(),
      );
      if (!this.commit(d, { modal: null, formErr: "", discardConfirm: false }))
        return;
      this.notify(
        {
          receipt: "입고를 저장했습니다. 재고와 보충 알림이 갱신되었습니다.",
          receiptEdit: "입고 수량을 정정했습니다. 차이만 재고에 반영했습니다.",
          receiptCancel: "입고를 취소했습니다. 변경 이력은 보존됩니다.",
          threshold: "보충 기준을 저장했습니다.",
          adjust: "실사 총수량으로 재고를 조정했습니다.",
        }[type],
      );
    } catch (e) {
      this.setState({ formErr: e.message || "입력 내용을 확인해 주세요." });
    } finally {
      this._inventorySaving = false;
      this.setState({ inventoryBusy: false });
    }
  }
  requestCloseModal() {
    if (this.state.inventoryBusy) return;
    if (
      this._formSnapshot &&
      JSON.stringify(this.state.form) !== this._formSnapshot
    ) {
      this.setState({ discardConfirm: true });
      return;
    }
    this.closeModal();
  }
  closeModal() {
    this._formSnapshot = null;
    this.setState({ modal: null, formErr: "", discardConfirm: false });
  }
  updateDialogFocus() {
    const open = !!this.state.modal;
    if (open === this._dialogOpen) return;
    this._dialogOpen = open;
    if (open) {
      this._bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => {
        const d = document.querySelector('[role="dialog"]');
        if (d) {
          const target = d.querySelector(
            "input:not([disabled]), textarea, button",
          );
          if (target) target.focus();
        }
      });
    } else {
      document.body.style.overflow = this._bodyOverflow || "";
      if (this._returnFocus && this._returnFocus.isConnected)
        this._returnFocus.focus();
    }
  }
  inventoryKeydown(e) {
    if (!this.state.modal) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.requestCloseModal();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]',
      ),
    ).filter((el) => el.getClientRects().length);
    const first = focusables[0],
      last = focusables[focusables.length - 1];
    if (!first) return;
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        !dialog.contains(document.activeElement))
    ) {
      e.preventDefault();
      last.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last ||
        !dialog.contains(document.activeElement))
    ) {
      e.preventDefault();
      first.focus();
    }
  }
  inventoryView() {
    const S = this.state,
      D = S.data,
      f = S.form || {},
      type = S.modal;
    const I = window.SalonInventory,
      fmt = (n) =>
        Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
    const statusClass = (status) =>
      "status-pill " +
      (status === "정상" ? "normal" : status === "품절" ? "out" : "low");
    const itemBy = (id) =>
      D.items.find((i) => i.id === id) || {
        name: "삭제된 품목",
        unit: "",
        qty: 0,
        min: 0,
      };
    const timeText = (at) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
      const date = new Date(at);
      return Number.isFinite(date.getTime())
        ? date.toLocaleString("ko-KR", { hour12: false })
        : "이전 기록";
    };
    const query = (S.invQuery || "").trim().toLocaleLowerCase();
    const items = D.items.filter(
      (i) =>
        (!S.invOnlyLow || I.stockStatus(i) !== "정상") &&
        i.name.toLocaleLowerCase().includes(query),
    );
    const inv = {
      totalCount: D.items.length,
      lowCount: D.items.filter((i) => I.stockStatus(i) !== "정상").length,
      todayCount: D.receipts.filter(
        (r) =>
          !r.legacyOrderId &&
          r.status === "active" &&
          r.changes[0] &&
          this.ymd(new Date(r.changes[0].at)) === this.today(),
      ).length,
      newReceipt: () => this.inventoryModal("receipt"),
      tabs: [
        ["stock", "재고 현황"],
        ["receipts", "입고 내역"],
        ["logs", "변경 이력"],
      ].map(([id, label]) => ({
        label,
        active: S.invTab === id,
        className: S.invTab === id ? "active" : "",
        pick: () => this.setState({ invTab: id }),
      })),
      isStock: S.invTab === "stock",
      isReceipts: S.invTab === "receipts",
      isLogs: S.invTab === "logs",
      query: S.invQuery,
      onQuery: (e) => this.setState({ invQuery: e.target.value }),
      onlyLow: S.invOnlyLow,
      toggleLow: () => this.setState({ invOnlyLow: !this.state.invOnlyLow }),
      filterLabel: S.invOnlyLow ? "✓ 보충 필요만 보기" : "보충 필요만 보기",
      stock: items.map((i) => ({
        testId: "inventory-item-" + i.id,
        name: i.name,
        kind: i.kind,
        qty: fmt(i.qty) + i.unit,
        min: fmt(i.min) + i.unit,
        status: I.stockStatus(i),
        statusClass: statusClass(I.stockStatus(i)),
        receive: () => this.inventoryModal("receipt", { itemId: i.id }),
        threshold: () => this.inventoryModal("threshold", { itemId: i.id }),
        adjust: () => this.inventoryModal("adjust", { itemId: i.id }),
      })),
      noStock: !items.length,
      emptyStockText: query
        ? "검색한 품목이 없습니다. 다른 이름으로 검색해 주세요."
        : "보충이 필요한 품목이 없습니다.",
      receipts: D.receipts
        .slice()
        .reverse()
        .map((r) => {
          const item = itemBy(r.itemId);
          return {
            testId: "receipt-" + r.id,
            id: r.id,
            item: item.name,
            date: r.date,
            qty: "+" + fmt(r.qty) + item.unit,
            actor: r.actorName || "기존 기록",
            memo: r.memo || "",
            legacy: !!r.legacyOrderId,
            statusText:
              r.status === "cancelled"
                ? "입고 취소"
                : r.revision
                  ? "정정됨"
                  : "입고 완료",
            statusClass:
              "status-pill " + (r.status === "cancelled" ? "out" : "normal"),
            canEdit: r.status === "active",
            correct: () =>
              this.inventoryModal("receiptEdit", { receiptId: r.id }),
            cancel: () =>
              this.inventoryModal("receiptCancel", { receiptId: r.id }),
            changeCount: r.changes.length,
            changes: r.changes
              .slice()
              .reverse()
              .map((h) => ({
                title:
                  h.kind +
                  " · " +
                  fmt(h.beforeQty) +
                  item.unit +
                  " → " +
                  fmt(h.afterQty) +
                  item.unit,
                detail: h.reason || "입고 등록",
                meta: timeText(h.at) + " · " + (h.actorName || "기존 기록"),
              })),
          };
        }),
      noReceipts: !D.receipts.length,
      logs: D.logs
        .slice()
        .reverse()
        .map((l) => {
          const item = itemBy(l.itemId);
          return {
            item: item.name,
            dt: l.at ? timeText(l.at) : l.dt,
            actor: l.actorName || "기존 기록",
            kind: l.kind,
            change:
              l.kind === "기준 변경"
                ? fmt(l.beforeMin) +
                  item.unit +
                  " → " +
                  fmt(l.afterMin) +
                  item.unit
                : (l.delta > 0 ? "+" : "") + fmt(l.delta) + item.unit,
            after: "재고 " + fmt(l.after) + item.unit,
            detail: [l.ref, l.reason && l.reason !== l.ref ? l.reason : ""]
              .filter(Boolean)
              .join(" · "),
          };
        }),
      noLogs: !D.logs.length,
    };
    const receipt = f.receiptId
      ? D.receipts.find((r) => r.id === f.receiptId)
      : null;
    const item = D.items.find(
      (i) => i.id === (receipt ? receipt.itemId : f.itemId),
    );
    const names = {
      receipt: "추가 입고 수량",
      receiptEdit: "올바른 입고 수량",
      threshold: "보충 기준 수량",
      adjust: "실사 총수량",
    };
    let preview = "품목과 수량을 입력하면 저장 후 재고를 확인할 수 있습니다.",
      afterStatus = "";
    if (item) {
      try {
        const qty =
          type === "receiptCancel"
            ? receipt.qty
            : I.parseQuantity(f.qty, item, {
                allowZero: type === "threshold" || type === "adjust",
              });
        const after =
          Math.round(
            (type === "receipt"
              ? Number(item.qty) + qty
              : type === "receiptEdit"
                ? Number(item.qty) + qty - Number(receipt.qty)
                : type === "receiptCancel"
                  ? Number(item.qty) - Number(receipt.qty)
                  : type === "adjust"
                    ? qty
                    : Number(item.qty)) * 1000,
          ) / 1000;
        if (type === "threshold") {
          preview =
            "기준 " +
            fmt(item.min) +
            item.unit +
            " → " +
            fmt(qty) +
            item.unit +
            " 이하";
          afterStatus =
            "현재 재고 " +
            fmt(item.qty) +
            item.unit +
            " · " +
            I.stockStatus(Object.assign({}, item, { min: qty }));
        } else {
          const delta = Math.round((after - item.qty) * 1000) / 1000;
          preview =
            type === "receipt"
              ? "현재 " +
                fmt(item.qty) +
                item.unit +
                " + 입고 " +
                fmt(qty) +
                item.unit +
                " = 저장 후 " +
                fmt(after) +
                item.unit
              : "현재 " +
                fmt(item.qty) +
                item.unit +
                " " +
                (delta >= 0 ? "+" : "−") +
                " " +
                fmt(Math.abs(delta)) +
                item.unit +
                " = 저장 후 " +
                fmt(after) +
                item.unit;
          afterStatus =
            after < 0
              ? "재고가 음수가 되어 저장할 수 없습니다."
              : "저장 후 상태: " +
                I.stockStatus(Object.assign({}, item, { qty: after }));
        }
      } catch (e) {
        preview = e.message;
      }
    }
    const iform = {
      isReceipt: type === "receipt",
      showItems: type === "receipt" && S.inventoryPickerOpen,
      toggleItems: () =>
        this.setState({ inventoryPickerOpen: !this.state.inventoryPickerOpen }),
      isCancel: type === "receiptCancel",
      hasItem: !!item,
      name: item ? item.name : "",
      current: item ? fmt(item.qty) + item.unit : "",
      minimum: item ? fmt(item.min) + item.unit : "",
      unit: item ? item.unit : "",
      qty: f.qty || "",
      date: f.date == null ? this.today() : f.date,
      maxDate: this.today(),
      memo: f.memo || "",
      reason: f.reason || "",
      actor: this.inventoryContext().actorName,
      quantityLabel: names[type] || "",
      showQuantity: type !== "receiptCancel",
      quantityHelp:
        type === "receipt"
          ? "현재 총재고가 아닌, 이번에 추가로 들어온 수량을 입력하세요."
          : type === "receiptEdit"
            ? "해당 입고 건의 올바른 수량입니다. 변경한 차이만 재고에 반영합니다."
            : type === "threshold"
              ? "이 수량 이하이면 보충 필요로 표시합니다. 0도 설정할 수 있습니다."
              : "실제로 세어 본 현재 총수량을 입력하세요. 기존 재고에 더하지 않습니다.",
      needsReason: ["receiptEdit", "receiptCancel", "adjust"].includes(type),
      reasonLabel:
        type === "receiptEdit"
          ? "정정 사유"
          : type === "receiptCancel"
            ? "취소 사유"
            : "조정 사유",
      previewLabel: type === "threshold" ? "보충 알림 기준" : "저장 전 확인",
      preview,
      afterStatus,
      onQty: (e) => this.setForm({ qty: e.target.value }),
      onDate: (e) => this.setForm({ date: e.target.value }),
      onMemo: (e) => this.setForm({ memo: e.target.value }),
      onReason: (e) => this.setForm({ reason: e.target.value }),
      items: D.items.map((i) => ({
        name: i.name,
        meta: "보유 " + fmt(i.qty) + i.unit,
        selected: f.itemId === i.id,
        className: "item-option" + (f.itemId === i.id ? " selected" : ""),
        pick: () => {
          this.setForm({ itemId: i.id, qty: "" });
          this.setState({ inventoryPickerOpen: false });
        },
      })),
    };
    return { inv, iform };
  }
  updStore(v) {
    const d = this.clone(this.state.data);
    d.store.name = v;
    this.commit(d);
  }
  updSvc(id, k, v) {
    const n = parseInt(String(v).replace(/\D/g, "") || "0", 10);
    const d = this.clone(this.state.data),
      s = d.services.find((x) => x.id === id);
    if (!s) return;
    if (k === "price") s.price = n;
    else if (s.mats[0]) s.mats[0].amt = n;
    if (!this.commit(d)) return;
  }
  reset() {
    if (!this.state.resetArmed) {
      this.setState({ resetArmed: true });
      return;
    }
    if (
      !this.commit(this.seed(), {
        resetArmed: false,
        page: "dashboard",
        payDraft: null,
        payResult: null,
        selResv: null,
        custDetailId: null,
        modal: null,
      })
    )
      return;
    this.notify("데모 데이터를 처음 상태로 되돌렸습니다.");
  }
  saveModal() {
    const m = this.state.modal;
    if (
      [
        "receipt",
        "receiptEdit",
        "receiptCancel",
        "threshold",
        "adjust",
      ].includes(m)
    ) {
      this.saveInventory();
      return;
    }
    if (m === "resv" || m === "walkin" || m === "edit") this.saveResv();
    else if (m === "txn") this.cancelTxn();
    else if (m === "customer") this.saveCust();
    else if (m === "staff") this.saveStaff();
  }
  renderVals() {
    const S = this.state,
      D = S.data,
      today = this.today(),
      P = this.props || {};
    const M = "var(--main, #1E4B8F)",
      T = "var(--tint, #EAF1FA)";
    const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
    const hm = (m) => this.hm(m),
      md = (s) => this.md(s),
      B = (t) => this.badge(t);
    const sum = (a, f) => a.reduce((x, y) => x + f(y), 0);
    const staffBy = (id) => D.staff.find((s) => s.id === id) || { name: "-" };
    const custBy = (id) => D.customers.find((c) => c.id === id);
    const svcBy = (id) =>
      D.services.find((v) => v.id === id) || {
        name: "-",
        price: 0,
        dur: 30,
        mats: [],
      };
    const itemBy = (id) =>
      D.items.find((i) => i.id === id) || {
        name: "-",
        unit: "",
        qty: 0,
        min: 0,
      };
    const rName = (r) =>
      r.custId ? (custBy(r.custId) || {}).name || "-" : r.guest || "비회원";
    const sNames = (ids) => (ids || []).map((id) => svcBy(id).name).join(" · ");
    const chip = (on) => ({
      bg: on ? M : "#FFFFFF",
      fg: on ? "#FFFFFF" : "#333333",
      bd: on ? M : "#D0D7E2",
    });
    const off = (r) => r.status === "취소" || r.status === "노쇼";
    const todays = D.resv
      .filter((r) => r.date === today)
      .sort((a, b) => a.start - b.start);
    const active = todays.filter((r) => !off(r));
    const waiting = D.resv
      .filter(
        (r) =>
          (r.date === today && r.status === "예약") || r.status === "시술 중",
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    const inProg = waiting.filter((r) => r.status === "시술 중").length;
    const low = D.items.filter((i) => this.stockSt(i) !== "정상");
    const todayTx = D.txns.filter(
      (t) => t.date === today && t.status !== "취소",
    );
    const designers = D.staff.filter(
      (s) => s.status === "재직" && s.role !== "스태프",
    );
    const mo = today.slice(0, 7);

    const nav = (k, label) => {
      const on = S.page === k;
      const c = k === "payment" ? inProg : k === "inventory" ? low.length : 0;
      return {
        label,
        go: () => this.go(k),
        bg: on ? T : "transparent",
        fg: on ? M : "#333333",
        fw: on ? "700" : "500",
        hasCount: c > 0,
        count: String(c),
        cbg: k === "inventory" ? "#C92A2A" : M,
      };
    };
    const titles = {
      dashboard: ["대시보드", "오늘 매장 현황"],
      schedule: ["예약·일정", "디자이너별 시간표 · 날짜를 바꿔 조회"],
      customers: ["고객 관리", "등록 고객과 방문·시술 이력"],
      payment: ["결제", "결제 기록 시 매출·이력·실적·재고가 함께 반영"],
      sales: ["매출 관리", "결제 완료일 기준 매출과 통계"],
      staff: ["직원 관리", "직원 정보와 개인 실적"],
      inventory: ["재고·입고", "수동 입고와 기준 수량에 따른 보충 알림"],
      settings: ["설정", "매장 정보와 시술 기본값"],
    };
    const WD = ["일", "월", "화", "수", "목", "금", "토"],
      nd = new Date();

    const doneN = todays.filter((r) => r.status === "완료").length,
      tSales = sum(todayTx, (t) => t.total);
    const dash = {
      kpis: [
        {
          label: "오늘 예약",
          value: active.length + "건",
          sub:
            "완료 " +
            doneN +
            "건 · 취소·노쇼 " +
            (todays.length - active.length) +
            "건",
          color: "#222222",
          go: () => this.go("schedule", { schedDate: today }),
        },
        {
          label: "결제 대기",
          value: waiting.length + "건",
          sub:
            "시술 중 " +
            inProg +
            "건 · 예약 " +
            (waiting.length - inProg) +
            "건",
          color: M,
          go: () => this.go("payment"),
        },
        {
          label: "오늘 매출",
          value: won(tSales),
          sub:
            "결제 완료 " +
            todayTx.length +
            "건 · 객단가 " +
            won(todayTx.length ? Math.round(tSales / todayTx.length) : 0),
          color: "#222222",
          go: () => this.go("sales", { salesPeriod: "today" }),
        },
        {
          label: "부족 재고",
          value: low.length + "개",
          sub: "품목별 기준 수량 이하 · 품절 포함",
          testId: "dashboard-low-stock",
          color: low.length ? "#C92A2A" : "#222222",
          go: () => this.go("inventory", { invTab: "stock" }),
        },
      ],
      today: todays.map((r) => ({
        time: hm(r.start),
        cust: rName(r),
        svc: sNames(r.svc),
        staff: staffBy(r.staffId).name,
        badge: B(r.status),
        canPay: r.status === "예약" || r.status === "시술 중",
        pay: () => this.startPay(r.id),
        open: () => this.go("schedule", { selResv: r.id, schedDate: r.date }),
      })),
      low: low.map((i) => ({
        name: i.name,
        qty: "보유 " + i.qty + i.unit + " · 기준 " + i.min + i.unit + " 이하",
        badge: B(this.stockSt(i)),
        canReceive: true,
        receive: () => this.inventoryModal("receipt", { itemId: i.id }),
      })),
      recent: D.txns
        .slice(-5)
        .reverse()
        .map((t) => ({
          dt: md(t.date) + " " + t.time,
          cust: t.customerName + (t.status === "취소" ? " (결제 취소)" : ""),
          staff: staffBy(t.staffId).name,
          total: won(t.total),
          open: () => this.openModal("txn", { txnId: t.id }),
        })),
    };
    dash.noToday = !dash.today.length;
    dash.noLow = !dash.low.length;
    const r1 = D.resv.find((r) => r.id === "r1");
    const demoOpen = !!(
      r1 &&
      r1.date === today &&
      !r1.txnId &&
      (r1.status === "예약" || r1.status === "시술 중")
    );

    const sdate = S.schedDate || today,
      dayR = D.resv
        .filter((r) => r.date === sdate)
        .sort((a, b) => a.start - b.start),
      dayActive = dayR.filter((r) => !off(r)),
      isPast = sdate < today;
    const open = D.store.open,
      nS = (D.store.close - open) / 30,
      colOf = {};
    designers.forEach((s, i) => {
      colOf[s.id] = i + 2;
    });
    const selR = S.selResv ? D.resv.find((r) => r.id === S.selResv) : null;
    const cells = [],
      times = [];
    for (let k = 0; k < nS; k++) {
      const m = open + k * 30,
        ls = m % 60 === 0 ? "dashed" : "solid";
      times.push({
        row: String(k + 2),
        label: hm(m),
        ls,
        fg: m % 60 === 0 ? "#222222" : "#5F6368",
        fw: m % 60 === 0 ? "600" : "400",
      });
      designers.forEach((s, i) =>
        cells.push({
          row: String(k + 2),
          col: String(i + 2),
          ls,
          title: s.name + " " + hm(m) + " 예약 등록",
          add: () => {
            if (isPast) this.notify("지난 날짜에는 예약을 등록할 수 없습니다.");
            else
              this.openModal("resv", { staffId: s.id, start: m, date: sdate });
          },
        }),
      );
    }
    const blocks = dayActive
      .filter((r) => colOf[r.staffId])
      .map((r) => {
        const k = (r.start - open) / 30,
          span = Math.max(1, Math.ceil(r.dur / 30)),
          st = r.status;
        const c =
          st === "시술 중"
            ? [M, "#FFFFFF", M]
            : st === "완료"
              ? ["#F3F4F6", "#444444", "#D0D7E2"]
              : [T, M, M];
        return {
          row: k + 2 + " / span " + span,
          col: String(colOf[r.staffId]),
          head:
            hm(r.start) +
            " " +
            rName(r) +
            (span >= 2 ? "" : " · " + sNames(r.svc)),
          full:
            hm(r.start) +
            "–" +
            hm(r.start + r.dur) +
            " " +
            rName(r) +
            " · " +
            sNames(r.svc) +
            " · " +
            st,
          svc: sNames(r.svc),
          status: st,
          tall: span >= 2,
          bg: c[0],
          fg: c[1],
          bd: c[2],
          shadow:
            S.selResv === r.id ? "0 0 0 3px #FFFFFF, 0 0 0 5px " + M : "none",
          open: () => this.setState({ selResv: r.id }),
        };
      });
    let sel = { badge: B("예약"), changes: [] };
    if (selR) {
      const c = selR.custId ? custBy(selR.custId) : null,
        st = selR.status;
      sel = {
        cust: rName(selR),
        kind: c ? "등록 고객" : "비회원",
        phone: c ? c.phone : selR.phone || "연락처 없음",
        time:
          hm(selR.start) +
          " – " +
          hm(selR.start + selR.dur) +
          " (" +
          selR.dur +
          "분)",
        staff: staffBy(selR.staffId).name,
        svc: sNames(selR.svc),
        est: won(sum(selR.svc, (id) => svcBy(id).price)),
        src: selR.src,
        memo: selR.memo || "—",
        badge: B(st),
        isResv: st === "예약" && selR.date === today,
        isFuture: st === "예약" && selR.date > today,
        isPastResv: st === "예약" && selR.date < today,
        canEdit: st === "예약" && selR.date >= today,
        isProg: st === "시술 중",
        isDone: st === "완료",
        isOff: off(selR),
        dateText: md(selR.date) + (selR.date === today ? " (오늘)" : ""),
        changes: (selR.changes || []).slice().reverse(),
        hasChanges: !!(selR.changes && selR.changes.length),
        edit: () => this.openModal("edit", { resvId: selR.id }),
        checkin: () => this.setResvStatus(selR.id, "시술 중"),
        pay: () => this.startPay(selR.id),
        cancel: () => this.setResvStatus(selR.id, "취소"),
        noshow: () => this.setResvStatus(selR.id, "노쇼"),
        viewTxn: () => this.openModal("txn", { txnId: selR.txnId }),
        close: () => this.setState({ selResv: null }),
      };
    }
    const offList = dayR.filter(off).map((r) => ({
      text: hm(r.start) + " " + rName(r) + " · " + r.status,
      open: () => this.setState({ selResv: r.id }),
    }));
    const sd = new Date(sdate + "T12:00:00");
    const sched = {
      date: sdate,
      dateLabel:
        sd.getMonth() +
        1 +
        "월 " +
        sd.getDate() +
        "일 " +
        WD[sd.getDay()] +
        "요일",
      dayNote:
        sdate === today ? "오늘" : isPast ? "지난 날짜 · 조회만 가능" : "예정",
      dayCount: "예약 " + dayActive.length + "건",
      onDate: (e) => this.setSchedDate(e.target.value),
      prev: () => this.shiftSched(-1),
      next: () => this.shiftSched(1),
      toToday: () => this.setSchedDate(today),
      notToday: sdate !== today,
      cols: "64px repeat(" + designers.length + ", minmax(170px, 1fr))",
      rows: "48px repeat(" + nS + ", 40px)",
      minW: 64 + designers.length * 170 + "px",
      heads: designers.map((s, i) => ({
        col: String(i + 2),
        name: s.name,
        role: s.role,
        count: dayActive.filter((r) => r.staffId === s.id).length + "건",
      })),
      times,
      cells,
      blocks,
      hasSel: !!selR,
      sel,
      off: offList,
      hasOff: offList.length > 0,
    };

    const cstat = (c) => {
      const all = D.txns.filter((t) => t.customerId === c.id),
        tx = all.filter((t) => t.status !== "취소");
      return {
        all,
        tx,
        visits: tx.length,
        total: sum(tx, (t) => t.total),
        last: tx.length ? tx[tx.length - 1].date : "",
      };
    };
    const q = (S.custQuery || "").trim(),
      qd = q.replace(/\D/g, "");
    const match = (c) =>
      !q ||
      c.name.indexOf(q) >= 0 ||
      (qd && c.phone.replace(/\D/g, "").indexOf(qd) >= 0);
    const cl = D.customers
      .filter(match)
      .map((c) => ({ c, st: cstat(c) }))
      .sort((a, b) => (b.st.last || "").localeCompare(a.st.last || ""));
    const dc = S.custDetailId ? custBy(S.custDetailId) : null;
    const cust = {
      isList: !dc,
      isDetail: !!dc,
      q: S.custQuery,
      onQ: (e) => this.setState({ custQuery: e.target.value }),
      count: "총 " + D.customers.length + "명",
      add: () => this.openModal("customer"),
      rows: cl.map((x) => ({
        name: x.c.name,
        phone: x.c.phone,
        visits: x.st.visits + "회",
        last: x.st.last ? md(x.st.last) : "방문 기록 없음",
        total: won(x.st.total),
        memo: x.c.memo || "—",
        open: () => this.setState({ custDetailId: x.c.id }),
      })),
      d: { hist: [], up: [] },
    };
    cust.noRows = !cust.rows.length;
    if (dc) {
      const st = cstat(dc),
        up = D.resv
          .filter(
            (r) =>
              r.custId === dc.id &&
              (r.date >= today || r.status === "시술 중") &&
              (r.status === "예약" || r.status === "시술 중"),
          )
          .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
      cust.d = {
        name: dc.name,
        phone: dc.phone,
        since: md(dc.since) + " 등록",
        memo: dc.memo || "메모 없음",
        visits: st.visits + "회",
        total: won(st.total),
        last: st.last ? md(st.last) : "—",
        hist: st.all
          .slice()
          .reverse()
          .map((t) => ({
            dt: md(t.date) + " " + t.time,
            svc: t.items.map((l) => l.name).join(" · "),
            staff: staffBy(t.staffId).name,
            amount: won(t.total),
            adeco: t.status === "취소" ? "line-through" : "none",
            badge: t.status === "취소" ? B("결제 취소") : B(t.custType),
            open: () => this.openModal("txn", { txnId: t.id }),
          })),
        up: up.map((r) => ({
          text:
            (r.date === today ? "오늘" : md(r.date)) +
            " " +
            hm(r.start) +
            " · " +
            sNames(r.svc) +
            " · " +
            staffBy(r.staffId).name,
          badge: B(r.status),
          go: () => this.go("schedule", { selResv: r.id, schedDate: r.date }),
        })),
        edit: () => this.openModal("customer", { custId: dc.id }),
        back: () => this.setState({ custDetailId: null }),
      };
      cust.d.noHist = !cust.d.hist.length;
      cust.d.hasUp = cust.d.up.length > 0;
    }

    const dr = S.payDraft,
      pr = S.payResult;
    const pay = {
      isList: !dr && !pr,
      isForm: !!dr && !pr,
      isResult: !!pr,
      list: waiting.map((r) => ({
        time: (r.date === today ? "" : md(r.date) + " ") + hm(r.start),
        cust: rName(r),
        svc: sNames(r.svc),
        staff: staffBy(r.staffId).name,
        badge: B(r.status),
        est: won(sum(r.svc, (id) => svcBy(id).price)),
        go: () => this.startPay(r.id),
      })),
      staffs: [],
      lines: [],
      addSvc: [],
      addProd: [],
      methods: [],
      stock: [],
      shorts: [],
      typeBadge: B("미등록"),
      res: { rows: [] },
    };
    pay.noList = !pay.list.length;
    if (dr) {
      const r = D.resv.find((x) => x.id === dr.resvId) || { svc: [], start: 0 };
      const c = r.custId ? custBy(r.custId) : null,
        prior = c
          ? D.txns.filter((t) => t.customerId === c.id && t.status !== "취소")
              .length
          : 0;
      const calc = this.payCalc(dr),
        need = this.payNeed(D, dr.lines),
        shorts = this.payShort(D, dr),
        shortBlock = shorts.length > 0 && !(dr.shortReason || "").trim();
      const inCart = (id) =>
        dr.lines.filter((l) => l.type === "product" && l.refId === id).length;
      const can = !calc.err && !S.processing && !shortBlock;
      Object.assign(pay, {
        cust: rName(r),
        kind: c ? "등록 고객" : "비회원",
        typeBadge: B(c ? (prior ? "재방문" : "신규") : "미등록"),
        info:
          (c ? c.phone : r.phone || "연락처 없음") +
          " · " +
          hm(r.start) +
          " 예약 (" +
          sNames(r.svc) +
          ")",
        staffs: designers.map((s) =>
          Object.assign(
            { name: s.name, pick: () => this.updDraft({ staffId: s.id }) },
            chip(dr.staffId === s.id),
          ),
        ),
        lines: dr.lines.map((l, i) => ({
          type: l.type === "service" ? "시술" : "상품",
          tbg: l.type === "service" ? T : "#F3F4F6",
          tfg: l.type === "service" ? M : "#444444",
          name: l.name,
          price: won(l.price),
          alloc: calc.alloc[i] ? "−" + won(calc.alloc[i]) : "—",
          afg: calc.alloc[i] ? "#C92A2A" : "#5F6368",
          net: won(l.price - (calc.alloc[i] || 0)),
          remove: () => this.removeLine(l.key),
        })),
        addSvc: D.services.map((v) => ({
          label: v.name,
          price: won(v.price),
          add: () => this.addLine("service", v.id),
        })),
        addProd: D.items
          .filter((i) => i.kind === "판매 상품")
          .map((i) => {
            const left = i.qty - inCart(i.id);
            return {
              label: i.name,
              meta:
                won(i.price) +
                " · " +
                (left > 0 ? "재고 " + left + "개" : "품절"),
              disabled: left <= 0,
              op: left > 0 ? "1" : "0.5",
              cur: left > 0 ? "pointer" : "not-allowed",
              add: () => {
                if (left > 0) this.addLine("product", i.id);
              },
            };
          }),
        discount: dr.discount,
        onDiscount: (e) =>
          this.updDraft({
            discount: e.target.value
              .replace(/\D/g, "")
              .replace(/^0+(?=\d)/, ""),
          }),
        methods: ["카드", "현금", "계좌이체"].map((m) =>
          Object.assign(
            { label: m, pick: () => this.updDraft({ method: m }) },
            chip(dr.method === m),
          ),
        ),
        sub: won(calc.sub),
        disc: calc.disc ? "−" + won(calc.disc) : "0원",
        total: won(calc.total),
        err:
          calc.err ||
          (shortBlock
            ? "재고가 부족합니다. 재고를 조정하거나 부족 사유를 입력해 주세요."
            : ""),
        hasErr: !!calc.err || shortBlock,
        shorts: shorts.map((x) => ({
          text:
            x.name +
            "가 " +
            x.short +
            x.unit +
            " 부족합니다. 실제 보유량을 확인해 주세요.",
          adjust: () => this.openModal("adjust", { itemId: x.id }),
        })),
        hasShort: shorts.length > 0,
        shortReason: dr.shortReason || "",
        onShortReason: (e) => this.updDraft({ shortReason: e.target.value }),
        stock: Object.keys(need).map((id) => {
          const it = itemBy(id),
            after = Math.max(0, it.qty - need[id]);
          return {
            name: it.name,
            use: "−" + need[id] + it.unit,
            fromTo: it.qty + it.unit + " → " + after + it.unit,
            badge: B(this.stockSt({ qty: after, min: it.min })),
          };
        }),
        submitLabel: S.processing
          ? "처리 중…"
          : "결제 기록 완료 · " + won(calc.total),
        cant: !can,
        sbg: can ? M : "#9AA0A6",
        scur: can ? "pointer" : "not-allowed",
        submit: () => this.submitPay(),
        cancel: () => this.setState({ payDraft: null }),
      });
      pay.noLines = !pay.lines.length;
      pay.noStock = !pay.stock.length;
    }
    if (pr)
      pay.res = {
        id: pr.id,
        total: won(pr.total),
        cust: pr.cust,
        rows: pr.rows.map((x) => ({
          label: x.label,
          value: x.value,
          hasBadge: !!x.badge,
          badge: x.badge || { t: "", bg: "", fg: "" },
        })),
        hasLow: pr.hasLow,
        toInv: () => this.go("inventory", { invTab: "stock" }),
        toSched: () => this.go("schedule"),
        toSales: () => this.go("sales", { salesPeriod: "today" }),
        again: () => this.setState({ payResult: null }),
      };

    const per = S.salesPeriod,
      wk = this.dayStr(-6);
    const stxAll = D.txns.filter((t) =>
        per === "today"
          ? t.date === today
          : per === "week"
            ? t.date >= wk && t.date <= today
            : t.date.slice(0, 7) === mo,
      ),
      stx = stxAll.filter((t) => t.status !== "취소"),
      cxN = stxAll.length - stx.length;
    const tot = sum(stx, (t) => t.total),
      vis = stx.length,
      agg = {};
    let pAmt = 0,
      pCnt = 0,
      sCnt = 0;
    stx.forEach((t) =>
      t.items.forEach((l) => {
        if (l.type === "service") {
          sCnt++;
          const a = agg[l.name] || (agg[l.name] = { n: 0, amt: 0 });
          a.n++;
          a.amt += l.net;
        } else {
          pCnt++;
          pAmt += l.net;
        }
      }),
    );
    const sv = Object.keys(agg)
      .map((k) => ({ name: k, n: agg[k].n, amt: agg[k].amt }))
      .sort((a, b) => b.amt - a.amt);
    const maxS = Math.max(1, ...sv.map((x) => x.amt));
    const stf = D.staff
      .map((s) => {
        const tt = stx.filter((t) => t.staffId === s.id);
        return { name: s.name, n: tt.length, amt: sum(tt, (t) => t.total) };
      })
      .filter((x) => x.n)
      .sort((a, b) => b.amt - a.amt);
    const maxT = Math.max(1, ...stf.map((x) => x.amt));
    const sales = {
      periods: [
        ["today", "오늘"],
        ["week", "최근 7일"],
        ["month", "이번 달"],
      ].map((p) =>
        Object.assign(
          { label: p[1], pick: () => this.setState({ salesPeriod: p[0] }) },
          chip(per === p[0]),
        ),
      ),
      range:
        per === "today"
          ? md(today)
          : per === "week"
            ? md(wk) + " – " + md(today)
            : +mo.slice(5) + "월 1일 – " + md(today),
      kpis: [
        { label: "총매출", value: won(tot), sub: "할인 반영 후 결제금액 합계" },
        { label: "방문 수", value: vis + "건", sub: "결제 완료 거래 건수" },
        {
          label: "객단가",
          value: won(vis ? Math.round(tot / vis) : 0),
          sub: "총매출 ÷ 방문 수",
        },
        {
          label: "시술 건수",
          value: sCnt + "건",
          sub: "거래에 포함된 시술 항목 수",
        },
      ],
      bySvc: sv.map((x) => ({
        name: x.name,
        n: x.n + "건",
        amt: won(x.amt),
        w: Math.max(2, Math.round((x.amt / maxS) * 100)) + "%",
      })),
      prodLine: pCnt
        ? "상품 판매 " + pCnt + "건 · " + won(pAmt) + " (시술별 매출과 별도)"
        : "이 기간 상품 판매 없음",
      byStaff: stf.map((x) => ({
        name: x.name,
        n: x.n + "건",
        amt: won(x.amt),
        w: Math.max(2, Math.round((x.amt / maxT) * 100)) + "%",
      })),
      types: ["신규", "재방문", "미등록"].map((k) => ({
        label: k,
        n: stx.filter((t) => t.custType === k).length + "건",
        badge: B(k),
      })),
      count: vis + "건" + (cxN ? " · 취소 " + cxN + "건은 합계 제외" : ""),
      rows: stxAll
        .slice()
        .reverse()
        .map((t) => ({
          id: t.id,
          dt: md(t.date) + " " + t.time,
          cust: t.customerName,
          badge: t.status === "취소" ? B("결제 취소") : B(t.custType),
          deco: t.status === "취소" ? "line-through" : "none",
          staff: staffBy(t.staffId).name,
          items: t.items.map((l) => l.name).join(" · "),
          disc: t.discount ? "−" + won(t.discount) : "—",
          total: won(t.total),
          method: t.method,
          open: () => this.openModal("txn", { txnId: t.id }),
        })),
    };
    sales.noSvc = !sales.bySvc.length;
    sales.noStaff = !sales.byStaff.length;
    sales.noRows = !sales.rows.length;

    const mTx = D.txns.filter(
      (t) => t.date.slice(0, 7) === mo && t.status !== "취소",
    );
    const sr = D.staff.map((s) => {
      const mt = mTx.filter((t) => t.staffId === s.id);
      return { s, n: mt.length, amt: sum(mt, (t) => t.total) };
    });
    const maxA = Math.max(1, ...sr.map((x) => x.amt));
    const staffPg = {
      monthLabel: +mo.slice(5) + "월 실적",
      add: () => this.openModal("staff"),
      rows: sr.map((x) => {
        const s = x.s,
          des = s.role !== "스태프";
        return {
          name: s.name,
          init: s.name.slice(0, 1),
          role: s.role,
          phone: s.phone,
          badge: B(s.status),
          today: des
            ? todayTx.filter((t) => t.staffId === s.id).length + "건"
            : "—",
          month: des ? won(x.amt) : "—",
          cnt: des ? x.n + "건" : "시술 담당 없음",
          isDes: des,
          w: Math.max(2, Math.round((x.amt / maxA) * 100)) + "%",
          tLabel: s.status === "재직" ? "휴직 처리" : "복직",
          toggle: () => this.toggleStaff(s.id),
        };
      }),
    };

    const { inv, iform } = this.inventoryView();

    const cfg = {
      name: D.store.name,
      onName: (e) => this.updStore(e.target.value),
      hours: hm(D.store.open) + " – " + hm(D.store.close) + " · 30분 단위 예약",
      svcs: D.services.map((v) => {
        const m = v.mats[0],
          it = m ? itemBy(m.itemId) : null;
        return {
          name: v.name,
          price: String(v.price),
          onPrice: (e) => this.updSvc(v.id, "price", e.target.value),
          dur: v.dur + "분",
          hasMat: !!m,
          noMat: !m,
          mat: it ? it.name : "없음",
          amt: m ? String(m.amt) : "",
          unit: it ? it.unit : "",
          onAmt: (e) => this.updSvc(v.id, "amt", e.target.value),
        };
      }),
      resetLabel: S.resetArmed
        ? "한 번 더 누르면 초기화됩니다"
        : "데모 데이터 초기화",
      rbg: S.resetArmed ? "#C92A2A" : "#FFFFFF",
      rfg: S.resetArmed ? "#FFFFFF" : "#C92A2A",
      reset: () => this.reset(),
    };

    const f = S.form || {},
      mt = S.modal;
    const mTitle = {
      resv: "예약 등록",
      walkin: "현장 접수",
      edit: "예약 수정",
      customer: f.custId ? "고객 정보 수정" : "고객 등록",
      staff: "직원 등록",
      receipt: "입고 등록",
      receiptEdit: "입고 수량 정정",
      receiptCancel: "입고 취소",
      threshold: "보충 기준 설정",
      adjust: "재고 조정",
      txn: "거래 상세",
    };
    const mSub = {
      resv: "같은 디자이너의 시간이 겹치면 저장되지 않습니다.",
      edit: "날짜·시간·담당자·시술을 바꿀 수 있습니다. 겹치는 시간은 저장되지 않습니다.",
      walkin: "접수하면 바로 ‘시술 중’ 상태로 등록됩니다.",
      customer:
        "방문할 때마다 새로 등록하지 않고, 기존 고객에게 이력이 쌓입니다.",
      staff: "원장·디자이너는 예약 시간표에 표시됩니다.",
      receipt: "실제로 들어온 수량을 입력하세요.",
      receiptEdit: "변경한 수량의 차이만 현재 재고에 반영합니다.",
      receiptCancel: "취소 사유를 남기고 입고 수량을 되돌립니다.",
      threshold: "기준 수량 이하이면 보충 필요로 표시합니다.",
      adjust: "실사 수량과 시스템 수량이 다를 때 사용합니다.",
    };
    const mSave = {
      resv: "예약 등록",
      walkin: "접수 완료",
      edit: "변경 저장",
      txn: "거래 취소 확정",
      customer: "저장",
      staff: "등록",
      receipt: "입고 저장",
      receiptEdit: "정정 저장",
      receiptCancel: "입고 취소 확정",
      threshold: "기준 저장",
      adjust: "조정 저장",
    };
    const modal = {
      open: !!mt,
      title: mTitle[mt] || "",
      sub: mSub[mt] || "",
      hasSub: !!mSub[mt],
      isResv: mt === "resv" || mt === "walkin" || mt === "edit",
      isCust: mt === "customer",
      isStaff: mt === "staff",
      isInventory: [
        "receipt",
        "receiptEdit",
        "receiptCancel",
        "threshold",
        "adjust",
      ].includes(mt),
      isTxn: mt === "txn",
      hasFooter: !!mt && (mt !== "txn" || !!f.cancelOpen),
      saveLabel: S.inventoryBusy ? "저장 중…" : mSave[mt] || "저장",
      busy: !!S.inventoryBusy,
      err: S.formErr,
      discardConfirm: !!S.discardConfirm,
      keepEditing: () => this.setState({ discardConfirm: false }),
      discard: () => this.closeModal(),
      close: () => this.requestCloseModal(),
      stop: (e) => e.stopPropagation(),
      save: () => this.saveModal(),
    };
    const fv = (k) => (e) => this.setForm({ [k]: e.target.value });
    const fh = {
      q: fv("q"),
      name: fv("name"),
      phone: fv("phone"),
      memo: fv("memo"),
      reason: fv("reason"),
      qty: (e) => this.setForm({ qty: e.target.value.replace(/\D/g, "") }),
    };

    let rf = { kinds: [], matches: [], svcs: [], staffs: [], slots: [] };
    if (modal.isResv) {
      const svcSel = f.svc || [],
        dur = sum(svcSel, (id) => svcBy(id).dur),
        d2 = dur || 30;
      const qq = (f.q || "").trim(),
        qqd = qq.replace(/\D/g, ""),
        picked = f.custId ? custBy(f.custId) : null,
        slots = [];
      for (let m = D.store.open; m < D.store.close; m += 30) {
        const free = this.isFree(
            D,
            f.date || today,
            f.staffId,
            m,
            d2,
            f.mode === "edit" ? f.resvId : null,
          ),
          on = f.start === m;
        slots.push({
          label: hm(m),
          disabled: !free,
          bg: on ? (free ? M : "#FDECEC") : free ? "#FFFFFF" : "#F3F4F6",
          fg: on
            ? free
              ? "#FFFFFF"
              : "#C92A2A"
            : free
              ? "#222222"
              : "#80868B",
          bd: on ? (free ? M : "#C92A2A") : "#D0D7E2",
          deco: free ? "none" : "line-through",
          cur: free ? "pointer" : "not-allowed",
          pick: () => this.setForm({ start: m }),
        });
      }
      rf = {
        kinds:
          f.mode === "edit"
            ? []
            : [
                ["reg", "등록 고객"],
                ["new", "신규 등록"],
                ["guest", "비회원"],
              ].map((k) =>
                Object.assign(
                  {
                    label: k[1],
                    pick: () => this.setForm({ ckind: k[0], custId: null }),
                  },
                  chip(f.ckind === k[0]),
                ),
              ),
        isReg: f.ckind === "reg" && f.mode !== "edit",
        isNew: f.ckind === "new" && f.mode !== "edit",
        isGuest: f.ckind === "guest" && f.mode !== "edit",
        isEdit: f.mode === "edit",
        editCust:
          f.mode === "edit"
            ? f.custId
              ? ((custBy(f.custId) || {}).name || "") +
                " · " +
                ((custBy(f.custId) || {}).phone || "")
              : (f.name || "비회원") + " · 비회원"
            : "",
        date: f.date || today,
        minDate: today,
        onDate: (e) => this.setForm({ date: e.target.value }),
        dateOpen: f.mode !== "walkin",
        dateLocked: f.mode === "walkin",
        dateText:
          md(f.date || today) + ((f.date || today) === today ? " (오늘)" : ""),
        hasPicked: !!picked,
        noPicked: !picked,
        pName: picked ? picked.name : "",
        pPhone: picked ? picked.phone : "",
        unpick: () => this.setForm({ custId: null }),
        matches: D.customers
          .filter(
            (c) =>
              !qq ||
              c.name.indexOf(qq) >= 0 ||
              (qqd && c.phone.replace(/\D/g, "").indexOf(qqd) >= 0),
          )
          .slice(0, 5)
          .map((c) => ({
            name: c.name,
            phone: c.phone,
            pick: () => this.setForm({ custId: c.id }),
          })),
        svcs: D.services.map((v) => {
          const on = svcSel.indexOf(v.id) >= 0;
          return {
            name: v.name,
            meta: won(v.price) + " · " + v.dur + "분",
            bg: on ? T : "#FFFFFF",
            bd: on ? M : "#D0D7E2",
            box: on ? M : "#FFFFFF",
            boxBd: on ? M : "#80868B",
            mark: on ? "✓" : "",
            toggle: () => this.toggleSvc(v.id),
          };
        }),
        staffs: designers.map((s) =>
          Object.assign(
            { name: s.name, pick: () => this.setForm({ staffId: s.id }) },
            chip(f.staffId === s.id),
          ),
        ),
        slots,
        summary: dur
          ? md(f.date || today) +
            " " +
            hm(f.start) +
            " – " +
            hm(f.start + dur) +
            " · 소요 " +
            dur +
            "분 · 예상 금액 " +
            won(sum(svcSel, (id) => svcBy(id).price))
          : "시술을 선택하면 소요 시간과 예상 금액이 표시됩니다.",
      };
      rf.noMatches = !rf.matches.length;
    }
    const sf = {
      roles: ["원장", "디자이너", "스태프"].map((r) =>
        Object.assign(
          { label: r, pick: () => this.setForm({ role: r }) },
          chip(f.role === r),
        ),
      ),
    };
    let tf = {
      lines: [],
      badge: B("미등록"),
      sBadge: B("결제 완료"),
      modes: [],
    };
    if (modal.isTxn) {
      const t = D.txns.find((x) => x.id === f.txnId);
      if (t)
        tf = {
          id: t.id,
          dt: md(t.date) + " " + t.time,
          cust: t.customerName,
          badge: B(t.custType),
          sBadge: B(t.status === "취소" ? "결제 취소" : "결제 완료"),
          isCx: t.status === "취소",
          canCancel: t.status !== "취소" && !f.cancelOpen,
          cancelOpen: t.status !== "취소" && !!f.cancelOpen,
          openCancel: () => this.setForm({ cancelOpen: true }),
          cxText: t.cancel
            ? md(t.cancel.dt.slice(0, 10)) +
              " " +
              t.cancel.dt.slice(11) +
              " 취소 · " +
              (t.cancel.mode === "redo" && t.resvId
                ? "정정 후 다시 기록"
                : "환불로 종료") +
              (t.cancel.restock ? " · 판매 상품 재고 복구" : "")
            : "",
          cxReason: t.cancel ? t.cancel.reason : "",
          hasProd: t.items.some((l) => l.type === "product"),
          modes: [
            [
              "redo",
              "정정 후 다시 기록",
              "예약을 결제 대기로 되돌리고 올바른 내용으로 다시 기록",
            ],
            ["refund", "환불로 종료", "거래만 취소하고 예약은 완료 상태로 둠"],
          ].map((m) => ({
            label: m[1],
            desc: m[2],
            pick: () => this.setForm({ cmode: m[0] }),
            bg: f.cmode === m[0] ? T : "#FFFFFF",
            bd: f.cmode === m[0] ? M : "#D0D7E2",
            dot: f.cmode === m[0] ? M : "#FFFFFF",
          })),
          restockBox: f.restock ? M : "#FFFFFF",
          restockMark: f.restock ? "✓" : "",
          toggleRestock: () => this.setForm({ restock: !f.restock }),
          staff: staffBy(t.staffId).name,
          method: t.method,
          lines: t.items.map((l) => ({
            type: l.type === "service" ? "시술" : "상품",
            name: l.name,
            price: won(l.price),
            alloc: l.alloc ? "−" + won(l.alloc) : "—",
            afg: l.alloc ? "#C92A2A" : "#5F6368",
            net: won(l.net),
          })),
          sub: won(t.subtotal),
          disc: t.discount ? "−" + won(t.discount) : "0원",
          total: won(t.total),
          isReg: !!t.customerId,
          toCust: () =>
            this.setState({
              modal: null,
              page: "customers",
              custDetailId: t.customerId,
            }),
        };
    }

    return {
      storeName: D.store.name || "매장",
      mobileNav: !!S.mobileNav,
      sidebarClass: "app-sidebar" + (S.mobileNav ? " open" : ""),
      toggleMobileNav: () =>
        this.setState({ mobileNav: !this.state.mobileNav }),
      navMain: [
        ["dashboard", "대시보드"],
        ["schedule", "예약·일정"],
        ["customers", "고객 관리"],
        ["payment", "결제"],
        ["sales", "매출 관리"],
        ["staff", "직원 관리"],
        ["inventory", "재고·입고"],
      ].map((p) => nav(p[0], p[1])),
      navSet: nav("settings", "설정"),
      pageTitle: titles[S.page][0],
      pageDesc: titles[S.page][1],
      todayLabel:
        nd.getMonth() +
        1 +
        "월 " +
        nd.getDate() +
        "일 (" +
        WD[nd.getDay()] +
        ")",
      isDash: S.page === "dashboard",
      isSched: S.page === "schedule",
      isCust: S.page === "customers",
      isPay: S.page === "payment",
      isSales: S.page === "sales",
      isStaff: S.page === "staff",
      isInv: S.page === "inventory",
      isSet: S.page === "settings",
      showGuide: P.showGuide !== false,
      demoLabel: demoOpen ? "10:00 한지원 결제 시작" : "예약·일정 보기",
      startDemo: () => {
        if (demoOpen) this.startPay("r1");
        else this.go("schedule");
      },
      goSched: () => this.go("schedule"),
      goInv: () => this.go("inventory", { invTab: "stock" }),
      goSales: () => this.go("sales"),
      openResv: () => this.openModal("resv", {}),
      openWalkin: () => this.openModal("walkin", {}),
      dash,
      sched,
      cust,
      pay,
      sales,
      staffPg,
      inv,
      cfg,
      modal,
      form: f,
      fh,
      rf,
      sf,
      iform,
      tf,
      toast: S.toast,
      hasToast: !!S.toast,
      saveErr: !!S.saveErr,
    };
  }
}
