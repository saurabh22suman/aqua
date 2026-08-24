type OtpSink = (phoneNumber: string, code: string) => void;

let sink: OtpSink = () => {};

export function setOtpSink(next: OtpSink): void {
  sink = next;
}

export function deliverOtp(phoneNumber: string, code: string): void {
  sink(phoneNumber, code);
}
