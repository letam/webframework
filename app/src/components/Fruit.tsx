import type { ReactElement } from "react";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import type { IFruit } from "types";
import ImageAttribution from "./ImageAttribution";

interface Properties {
  fruit: IFruit;
}
export default function Fruit({ fruit }: Properties): ReactElement {
  const navigate = useNavigate();
  const onClick = useCallback(
    (event: React.SyntheticEvent<HTMLElement, Event>) => {
      if ((event.target as HTMLElement).nodeName === "A") {
        return;
      }

      window.scrollTo(0, 0);
      navigate("/" + fruit.name.toLowerCase()); // eslint-disable-line prefer-template
    },
    [fruit.name, navigate]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter") {
        onClick(event);
      }
    },
    [onClick]
  );

  const imageWidth = Math.min(384, window.innerWidth - 16);
  const imageHeight = imageWidth / (16 / 9);

  return (
    <div
      data-testid="FruitCard"
      className="select-none focus:outline-none focus:ring focus:ring-opacity-50 focus:ring-gray-500 focus:border-gray-300 cursor-pointer overflow-hidden shadow-lg dark:shadow-2xl rounded-lg"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="relative">
        <img
          data-testid="FruitCardImage"
          loading="lazy"
          width={imageWidth}
          height={imageHeight}
          style={{
            backgroundColor: fruit.image.color,
          }}
          src={`${fruit.image.url}&w=${
            imageWidth * window.devicePixelRatio
          }&h=${imageHeight * window.devicePixelRatio}`}
          alt={fruit.name}
        />
        <ImageAttribution author={fruit.image.author} />
      </div>
      <h3 data-testid="FruitCardName" className="p-6 font-bold text-xl">
        {fruit.name}
      </h3>
    </div>
  );
}
