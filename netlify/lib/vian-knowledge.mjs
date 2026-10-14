/* Vian's public-only business knowledge. Edit as businesses change.
   Do NOT add admin keys, customer records, private PDF paths or internal data. */
import { openVSHStore } from "./catalogue-store.mjs";

export const VIAN_BUSINESS_KNOWLEDGE = `
Van Schalkwyk Holdings: "Different passions. One family." A family of businesses based in South Africa: Granny's, CleverCubs Learning, Nuvetriq, PurEss and Cricut. The official education business name must ALWAYS be "CleverCubs Learning", not "Clever Cubs" or "CleverCubs" alone. This assistant lives ONLY on the Van Schalkwyk Holdings website, not on Nuvetriq's own website.

1) GRANNY'S: a home bakery, "Homemade with love." Handmade gourmet popcorn, cake popsicles, cookies, biscuits, party snacks and sweet treats for parties, everyday enjoyment and special occasions. Granny's also has a digital recipe-books collection on this website; where a book is published with a digital PDF, shoppers can use the recipe-books section to add it to a basket. The Yoco checkout and automatic email delivery system is being developed and must not be described as live unless it really is operational. Ordering physical treats: enquiries via WhatsApp to Chantel 075 390 8063, or email grannyspopsandtreats@gmail.com. Granny's main contact number: 067 125 0896. Website within Holdings: grannys-little-bakery.html ; recipe books: grannys-little-bakery.html#recipe-books.

2) CleverCubs Learning: educational resources and activity books, including CAPS-aligned South African learning materials for different grades, with digital PDF books. The bookshop allows visitors to browse by categories and grade. A live Yoco checkout and automatic digital PDF delivery for CleverCubs Learning are planned, not currently confirmed operational. Contacts: Nelia 067 125 0896, Chantel 075 390 8063; email learningclevercubs@gmail.com. Website within Holdings: clever-cubs-learning.html.

3) NUVETRIQ: "Smart digital solutions." Separate company and website https://nuvetriq.com; contact Hano 065 185 2407, email nuvetriq@gmail.com. Specialises in websites/redesigns, business systems and Excel automation, Power BI and data analytics, business dashboards, AI-powered business/website assistants, professional CV creation, logo design, catalogues, reconciliations, business plans, packages, event/wedding/product photography and image editing, drone photography/video and mapping. Scope and pricing for custom work must be confirmed directly by Nuvetriq. Nia is Nuvetriq's own AI assistant. Vian can explain Nuvetriq's publicly advertised services and refer people to nuvetriq.com, but Vian does NOT operate on Nuvetriq's website or access Nia's conversations or records.

4) PURESS: a coming-soon business for essential oils and soap. Not yet launched. No confirmed product range, opening date or prices. Information page on Holdings: puress.html.

5) CRICUT: a coming-soon custom vinyl and craft-creations business. Not yet launched. No confirmed launch date, inventory or prices. Information page on Holdings: cricut.html.

Holdings homepage: index.html; the homepage links to all five businesses. Visitors can choose a business based on needs (sweet treats or recipe books → Granny's; educational books → CleverCubs Learning; websites/AI/data/creative digital services → Nuvetriq; essential oils/soap → PurEss coming soon; custom crafts/vinyl → Cricut coming soon).
`;

const products = () => openVSHStore({name:"vsh-products",consistency:"strong"});
export async function getPublicProductKnowledge() {
  const store = products();
  const sections = [];
  for(const business of ["grannys","clever-cubs"]) {
    try {
      const {blobs} = await store.list({prefix:business+"/"});
      const limited=blobs.slice(0,80);
      const records = await Promise.all(limited.map(entry=>store.get(entry.key,{type:"json"})));
      const published=records.filter(r=>r && r.business===business && r.is_active===true).slice(0,35);
      const descriptions=published.map(r=>{
        const title=String(r.title||"").slice(0,90);
        const category=String(r.category||"").slice(0,70);
        const grade=String(r.grade||"").slice(0,65);
        const description=String(r.description||"").slice(0,170);
        const price=Number(r.price);
        return "- "+title+" | "+category+(grade?" | "+grade:"")+
          (Number.isFinite(price)?" | R"+price.toFixed(2):"")+
          (description?" | "+description:"");
      });
      sections.push(business.toUpperCase()+" PUBLISHED PRODUCTS ONLY:\n"+
        (descriptions.length?descriptions.join("\n"):"There are no published products in this catalogue yet."));
    } catch (error) {
      console.warn("Vian: public catalogue not available for",business);
      sections.push(business.toUpperCase()+" PUBLISHED PRODUCTS: live catalogue data temporarily unavailable. Do not invent individual listings.");
    }
  }
  return sections.join("\n\n");
}
