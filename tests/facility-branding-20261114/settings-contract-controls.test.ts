import { expect, it } from "vitest";
import { saveClubBillingDefaultSchema, createBillingRegistrationSchema } from "@/lib/services/facility-billing-contract";
const address={line1:"Road 11",line2:null,city:"Mumbai",postalCode:"400001"};
const input={legalName:"भारत खेल",legalAddress:address,stateCode:"27",gstin:"27ABCDE1234F1Z5"};
it.each(["\u0001","\u0009","\u000a","\u007f","\u0085"])("refuses an embedded control character %j in a legal issuer",control=>{
  expect(saveClubBillingDefaultSchema.safeParse({...input,legalName:`Legal${control}Name`}).success).toBe(false);
  expect(createBillingRegistrationSchema.safeParse({...input,legalAddress:{...address,line1:`Road${control}11`}}).success).toBe(false);
});
it("preserves realistic Unicode and joined Indic names",()=>{
  expect(saveClubBillingDefaultSchema.safeParse({...input,legalName:"किरण क्रीडा क्लब",legalAddress:{...address,line1:"ಬೆಂಗಳೂರು ರಸ್ತೆ"}}).success).toBe(true);
});
