import type { IFruit } from "../types";
import { STATIC_APP_ROOT } from "../utils/misc";

export default async function getFruits(): Promise<IFruit[]> {
  const response = await fetch(`${STATIC_APP_ROOT}fruits.json`);
  return response.json() as Promise<IFruit[]>;
}
