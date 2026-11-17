import { describe,expect,it } from "vitest";
import { buildHourlyBuckets,addBookingToBuckets } from "@/lib/services/utilisation-buckets";
import type { BusinessHours } from "@/lib/services/locations";
function minutes(start:string,end:string,timezone="UTC") {
  const hours={days:[{day:"monday",open:"00:00",close:"23:00",closed:false}]} as BusinessHours;
  const buckets=buildHourlyBuckets({facilities:[{id:"court",locationId:"site"}],hoursByLocation:new Map([["site",hours]]),fromDate:"2026-11-09",days:1,timezone});
  addBookingToBuckets(buckets,{facilityId:"court",startsAt:new Date(start),endsAt:new Date(end)},timezone);
  return [...buckets.values()].reduce((n,b)=>n+b.bookedMinutes,0);
}
describe("F07 half-open booking overlap accounting",()=>{
  it.each([
    ["10:10","10:40",30],["10:30","11:30",60],["10:00","11:00",60],
    ["10:00","10:00",0],["10:10","12:25",135],
  ])("counts %s to %s as %d minutes",(from,to,expected)=>{
    expect(minutes(`2026-11-09T${from}:00Z`,`2026-11-09T${to}:00Z`)).toBe(expected);
  });
  it("counts partial hours in the club's India timezone",()=>{
    expect(minutes("2026-11-09T04:40:00Z","2026-11-09T05:10:00Z","Asia/Kolkata")).toBe(30);
  });
});
