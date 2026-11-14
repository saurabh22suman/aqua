import { describe,expect,it } from "vitest";
import { compareRules } from "@/lib/services/booking-pricing";
import type { BookingPriceRule } from "@/db/schema/bookings";
function rule(days:number[],id:string,priority=0) {
  return {id,priority,facilityId:null,startTime:null,endTime:null,daysOfWeek:days} as BookingPriceRule;
}
describe("F08 day-specific booking prices",()=>{
  it("prefers one matching weekday over five, regardless of UUID order",()=>{
    const broad=rule([1,2,3,4,5],"a"),narrow=rule([1],"z");
    expect([broad,narrow].sort(compareRules)[0]).toBe(narrow);
  });
  it("normalizes duplicate weekdays before comparing specificity",()=>{
    const broad=rule([1,2],"a"),narrow=rule([1,1,1],"z");
    expect([broad,narrow].sort(compareRules)[0]).toBe(narrow);
  });
  it("treats an empty set as all seven days",()=>{
    const broad=rule([],"a"),narrow=rule([1,2],"z");
    expect([broad,narrow].sort(compareRules)[0]).toBe(narrow);
  });
  it("preserves explicit priority before day specificity",()=>{
    const broad=rule([1,2,3],"a",1),narrow=rule([1],"z");
    expect([broad,narrow].sort(compareRules)[0]).toBe(broad);
  });
});
