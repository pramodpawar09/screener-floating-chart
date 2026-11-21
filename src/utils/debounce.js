// A resettable single-shot timer; used for hover-open and hide delays.
export function createTimer() {
  let id = null;
  return {
    set(fn, ms) {
      clearTimeout(id);
      id = setTimeout(() => {
        id = null;
        fn();
      }, ms);
    },
    clear() {
      clearTimeout(id);
      id = null;
    },
    get pending() {
      return id !== null;
    },
  };
}
