"use client";

import { useParams } from "next/navigation";
import { EvidenceDetail } from "../../evidence-library";

export default function ClearanceEvidencePage(){
  const params=useParams<{kNumber:string}>();
  return <EvidenceDetail kNumber={String(params.kNumber||"").toUpperCase()}/>;
}
