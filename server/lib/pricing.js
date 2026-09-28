const T = require('./time');

class PricingError extends Error {}

function findCoupon(db, code, now) {
  if (!code) return null;
  const c = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(String(code).trim());
  if (!c) throw new PricingError('Invalid coupon code');
  if (c.valid_until && c.valid_until < T.nowIST(now).date) throw new PricingError('This coupon has expired');
  if (c.max_uses != null && c.used_count >= c.max_uses) throw new PricingError('This coupon has reached its usage limit');
  return c;
}

/**
 * Computes the full price breakdown (whole rupees). Never trust prices from the client.
 * @param {object} p
 * @param {object} p.treatment
 * @param {object|null} p.pkg         package being purchased
 * @param {string} p.mode             clinic | home | online
 * @param {string|null} p.couponCode
 * @param {boolean} p.usingCredit     session paid from an existing package
 */
function computePrice(db, { treatment, pkg = null, mode, couponCode = null, usingCredit = false, settings, now }) {
  const sessions = pkg ? pkg.sessions : 1;
  const unitPrice = treatment.price;
  const subtotal = usingCredit ? 0 : unitPrice * sessions;
  const packageDiscount = pkg ? Math.round((subtotal * pkg.discount_percent) / 100) : 0;
  const surcharge = mode === 'home' ? settings.home_visit_fee : 0;

  let couponDiscount = 0;
  let coupon = null;
  if (couponCode) {
    if (usingCredit) throw new PricingError('Coupons cannot be applied to package sessions');
    coupon = findCoupon(db, couponCode, now);
    const base = subtotal - packageDiscount;
    if (base < coupon.min_amount) {
      throw new PricingError(`This coupon needs a minimum booking value of ₹${coupon.min_amount.toLocaleString('en-IN')}`);
    }
    couponDiscount = coupon.type === 'percent' ? Math.round((base * coupon.value) / 100) : Math.round(coupon.value);
    if (coupon.max_discount != null) couponDiscount = Math.min(couponDiscount, coupon.max_discount);
    couponDiscount = Math.min(couponDiscount, base);
  }

  const taxable = subtotal - packageDiscount - couponDiscount + surcharge;
  const tax = Math.round((taxable * (settings.gst_percent || 0)) / 100);
  const total = taxable + tax;

  return {
    unit_price: unitPrice,
    sessions,
    subtotal,
    package_discount: packageDiscount,
    coupon_discount: couponDiscount,
    coupon_code: coupon ? coupon.code : null,
    surcharge,
    tax,
    gst_percent: settings.gst_percent || 0,
    total,
  };
}

module.exports = { computePrice, findCoupon, PricingError };
