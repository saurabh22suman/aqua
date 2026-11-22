"use client";

import dynamic from "next/dynamic";

// Notes are a separately selected server-rendered tab. Keep their client
// implementation out of the overview's initial JavaScript graph.
export const MemberNotesPanel = dynamic(
  () => import("./member-notes-content").then((module) => module.MemberNotesPanel),
);
