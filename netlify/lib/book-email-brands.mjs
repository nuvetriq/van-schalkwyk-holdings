// Future paid-book confirmation emails. Do not call from public pages.
// Each business has its own verified sender identity.
export const BOOK_EMAIL_BRANDS = Object.freeze({
  grannys: {
    name: "Granny's",
    from: "grannyspopsandtreats@gmail.com",
    gmailUserVar: "VSH_GRANNYS_GMAIL_USER",
    gmailAppPasswordVar: "VSH_GRANNYS_GMAIL_APP_PASSWORD"
  },
  "clever-cubs": {
    name: "CleverCubs Learning",
    from: "learningclevercubs@gmail.com",
    gmailUserVar: "VSH_CLEVERCUBS_GMAIL_USER",
    gmailAppPasswordVar: "VSH_CLEVERCUBS_GMAIL_APP_PASSWORD"
  }
});
export function bookEmailBrand(business) {
  if (!Object.hasOwn(BOOK_EMAIL_BRANDS, business))
    throw new Error("Unknown business for digital-book email.");
  return BOOK_EMAIL_BRANDS[business];
}
