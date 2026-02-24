import { NextResponse } from "next/server";
import { collectAvailableTags, filterDocsByTags, getAgentReadingPath, getDocCatalog } from "../../../lib/docs";

function parseRequestedTags(request: Request): string[] {
  const url = new URL(request.url);
  const rawTags = [
    ...url.searchParams.getAll("tag"),
    ...url.searchParams.getAll("tags")
  ]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(rawTags)];
}

export async function GET(request: Request) {
  const requestedTags = parseRequestedTags(request);
  const docs = getDocCatalog();
  const filteredDocs = filterDocsByTags(docs, requestedTags);
  const filteredAgentPath = filterDocsByTags(getAgentReadingPath(), requestedTags);

  return NextResponse.json({
    version: 1,
    generatedAt: new Date().toISOString(),
    requestedTags,
    availableTags: collectAvailableTags(docs),
    docs: filteredDocs,
    agentReadingPath: filteredAgentPath
  });
}
