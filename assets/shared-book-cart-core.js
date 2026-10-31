/* Shared digital-book cart state for Granny's + CleverCubs Learning.
   This is product selection only, NEVER an order or payment record. */
(function (root) {
  "use strict";
  const KEY = "vsh-digital-book-cart-v1";
  const BUSINESSES = Object.freeze(["grannys", "clever-cubs"]);
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MAX = 20;

  function valid(item) {
    return item && typeof item === "object" &&
      BUSINESSES.includes(item.business) && ID.test(item.id || "");
  }
  function normalize(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set(), result = [];
    for (const item of value) {
      if (!valid(item)) continue;
      const key = item.business + ":" + item.id.toLowerCase();
      if (seen.has(key)) continue;
      result.push({business:item.business, id:item.id.toLowerCase()});
      seen.add(key);
      if (result.length === MAX) break;
    }
    return result;
  }
  function create(storage, changed) {
    const notify = typeof changed === "function" ? changed : () => {};
    let items = [];
    function read() {
      try { return normalize(JSON.parse(storage.getItem(KEY) || "[]")); }
      catch { return []; }
    }
    items = read();
    function update(next) {
      items = normalize(next);
      try { storage.setItem(KEY, JSON.stringify(items)); } catch {}
      notify(items.map(item => ({...item})));
    }
    return {
      items() { return items.map(item => ({...item})); },
      add(business,id) {
        const item={business,id};
        if (!valid(item)) return false;
        const unique = business + ":" + id.toLowerCase();
        if (items.some(x => x.business + ":" + x.id === unique) || items.length >= MAX) return false;
        update([...items,item]); return true;
      },
      remove(business,id) {
        const filtered=items.filter(x => !(x.business === business && x.id === String(id).toLowerCase()));
        if (filtered.length === items.length) return false;
        update(filtered); return true;
      },
      clear() { update([]); },
      refresh() {
        const next=read();
        if (JSON.stringify(next) !== JSON.stringify(items)) {
          items=next; notify(this.items());
        }
      }
    };
  }
  root.VSH_BOOK_CART_CORE = Object.freeze({KEY, MAX, BUSINESSES, normalize, create});
})(typeof window !== "undefined" ? window : globalThis);
