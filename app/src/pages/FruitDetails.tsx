import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import getFruits from "../api/getFruits";
import { useMediaQuery } from "../utils/responsive";
import Head from "../components/Head";
import ImageAttribution from "../components/ImageAttribution";
import LoadingOrError from "../components/LoadingOrError";
import PageNotFound from "./PageNotFound";

import type { IFruit } from "../types";

const DESKTOP_IMAGE_WIDTH_PERCENTAGE = 0.4;
const MOBILE_IMAGE_HEIGHT_PERCENTAGE = 0.3;

export default function FruitDetails(): ReactElement {
  const isTabletAndUp = useMediaQuery("(min-width: 600px)");
  const navigate = useNavigate();
  const { fruitName } = useParams<{ fruitName: string }>();
  const { isLoading, isError, error, data } = useQuery({
    queryKey: ["fruits"],
    queryFn: getFruits,
  });
  const isLoadingOrError = isLoading || isError;
  const fruit = data?.find(
    (f) => f.name.toLowerCase() === fruitName?.toLowerCase()
  ) as IFruit;

  if (isLoadingOrError) {
    return <LoadingOrError error={error as Error} />;
  }

  if (!fruit) {
    return (
      <PageNotFound>
        <div>Data for fruit &apos;{fruitName}&apos; not found.</div>
      </PageNotFound>
    );
  }

  const imageWidth =
    (isTabletAndUp
      ? window.innerWidth * DESKTOP_IMAGE_WIDTH_PERCENTAGE
      : window.innerWidth) * window.devicePixelRatio;
  const imageHeight =
    (isTabletAndUp
      ? window.innerHeight
      : window.innerHeight * MOBILE_IMAGE_HEIGHT_PERCENTAGE) *
    window.devicePixelRatio;

  function onClickBackLink(): void {
    const previousURLIndex = -1;
    navigate(previousURLIndex);
  }

  return (
    <>
      <Head title={fruit.name} />
      <div className="min-h-screen flex flex-col sm:flex-row items-center">
        <div className="relative">
          <img
            data-testid="FruitImage"
            width={imageWidth}
            height={imageHeight}
            style={{
              backgroundColor: fruit.image.color,
            }}
            src={`${fruit.image.url}&w=${imageWidth}&h=${imageHeight}`}
            alt={fruit.name}
          />
          <ImageAttribution author={fruit.image.author} />
        </div>
        <div className="my-8 sm:my-0 sm:ml-16">
          <button
            type="button"
            data-testid="BackLink"
            onClick={onClickBackLink}
            className="flex items-center"
          >
            <img src="/icons/arrow-left.svg" alt="" className="h-5 w-5" />
            <span className="ml-4 text-xl">Back</span>
          </button>

          <h1
            data-testid="FruitName"
            className="mt-2 sm:mt-8 text-6xl font-bold"
          >
            {fruit.name}
          </h1>
          <h2 className="mt-3 text-xl text-gray-500 dark:text-gray-400">
            Vitamins per 100 g (3.5 oz)
          </h2>
          <table className="mt-8 text-lg">
            <thead>
              <tr>
                <th className="px-4 py-2">Vitamin</th>
                <th className="px-4 py-2">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {fruit.metadata.map(({ name, value }) => (
                <tr key={`FruitVitamin-${name}`} className="font-medium">
                  <td className="border border-gray-300 px-4 py-2">{name}</td>
                  <td className="border border-gray-300 px-4 py-2">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
