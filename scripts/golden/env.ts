// Makes a golden run give byte-identical results on any machine: the tree's timezone, one fixed locale,
// and a Date that follows the simulated clock. Import this FIRST (before the bench), so START and every
// `new Date()` / `Date.now()` in the engines and routes already see it.
process.env.TZ = 'Asia/Beirut';

const RealDate = Date;
let source: () => number = () => RealDate.now();

// From now on Date.now() and `new Date()` read this clock (the bench's simulated time)
export const followClock = (now: () => number) => {
  source = now;
};

class SimDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(source());
    else super(...(args as [number]));
  }
  static now() {
    return source();
  }
}
globalThis.Date = SimDate as DateConstructor;

// `toLocaleTimeString([])` follows the machine's locale: pin it (an explicit locale is left alone)
type LocaleFn = (this: Date, locales?: string | string[], opts?: Intl.DateTimeFormatOptions) => string;
const pin = (orig: LocaleFn): LocaleFn =>
  function (this: Date, locales, opts) {
    const unset = locales === undefined || (Array.isArray(locales) && locales.length === 0);
    return orig.call(this, unset ? 'en-GB' : locales, { timeZone: 'Asia/Beirut', ...opts });
  };
RealDate.prototype.toLocaleTimeString = pin(RealDate.prototype.toLocaleTimeString);
RealDate.prototype.toLocaleDateString = pin(RealDate.prototype.toLocaleDateString);
RealDate.prototype.toLocaleString = pin(RealDate.prototype.toLocaleString);
