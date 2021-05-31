import { IPost } from "types";

const BACKEND_HOST = (import.meta.env.VITE_BACKEND_HOST as string) || "";

export default async function getPosts(): Promise<IPost[]> {
  return (await fetch(`${BACKEND_HOST}/api/posts/`)).json() as Promise<IPost[]>;
}
