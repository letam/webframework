import { IPost } from "types";
import { BACKEND_HOST } from "api/constants";

export default async function getPosts(): Promise<IPost[]> {
  return (await fetch(`${BACKEND_HOST}/api/posts/`)).json() as Promise<IPost[]>;
}
