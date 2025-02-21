import type { IPost } from "../types";
import { BACKEND_HOST } from "../api/constants";

export default async function getPosts(): Promise<IPost[]> {
  const response = await fetch(`${BACKEND_HOST}/api/posts/`);
  return response.json() as Promise<IPost[]>;
}
