import "server-only";

// The simulated checkout marks bills paid without charging a card, so it only runs outside production
// unless an administrator explicitly allows it (CAREHUB_ALLOW_TEST_PAYMENTS=1) for a supervised test.
export function testPaymentsAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.CAREHUB_ALLOW_TEST_PAYMENTS === "1";
}
