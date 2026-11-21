// Pure state machine for the floating chart.
//
//   phase:  CLOSED -> LOADING -> OPEN | ERROR     (pinned is an orthogonal flag; viewState() reports PINNED)
//
//   SHOW(key)    any      -> LOADING   (new stock hovered; panel is reused, never duplicated)
//   RELOAD       !CLOSED  -> LOADING   (timeframe change / retry)
//   LOADED       LOADING  -> OPEN
//   FAILED       LOADING  -> ERROR
//   PIN/UNPIN/TOGGLE_PIN  only while !CLOSED
//   HIDE         !pinned  -> CLOSED    (hide timer fired; ignored while pinned)
//   CLOSE        any      -> CLOSED, pinned=false  (close button / Escape)
export const initialState = Object.freeze({ phase: 'CLOSED', pinned: false, key: null });

export function reduce(state, event) {
  const closed = state.phase === 'CLOSED';
  switch (event.type) {
    case 'SHOW':
      return { ...state, phase: 'LOADING', key: event.key };
    case 'RELOAD':
      return closed ? state : { ...state, phase: 'LOADING' };
    case 'LOADED':
      return state.phase === 'LOADING' ? { ...state, phase: 'OPEN' } : state;
    case 'FAILED':
      return state.phase === 'LOADING' ? { ...state, phase: 'ERROR' } : state;
    case 'PIN':
      return closed ? state : { ...state, pinned: true };
    case 'UNPIN':
      return { ...state, pinned: false };
    case 'TOGGLE_PIN':
      return closed ? state : { ...state, pinned: !state.pinned };
    case 'HIDE':
      return closed || state.pinned ? state : { ...initialState };
    case 'CLOSE':
      return { ...initialState };
    default:
      return state;
  }
}

export const viewState = (s) => (s.phase !== 'CLOSED' && s.pinned ? 'PINNED' : s.phase);
