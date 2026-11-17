"use client";

export function MemberManagementLink({ target, children }: {
  target: "participation" | "enrolment" | "plan";
  children: string;
}) {
  function open() {
    const disclosure = document.getElementById("member-management");
    const destination = document.getElementById(`member-management-${target}`);
    if (!(disclosure instanceof HTMLDetailsElement) || !destination) return;
    disclosure.open = true;
    if (target === "participation") {
      const statusEditor = destination.querySelector("details");
      if (statusEditor) statusEditor.open = true;
    }
    destination.focus();
  }
  return <button type="button" onClick={open} className="mt-1 inline-flex min-h-11 items-center text-[13px] text-ink-2 underline underline-offset-2">{children}</button>;
}
