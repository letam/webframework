import React, { ReactElement } from "react";
import { IPost } from "types";

interface Properties {
  post: IPost;
}
export default function Post({ post }: Properties): ReactElement {
  return (
    <div data-cy="PostCard" tabIndex={0}>
      <h3 data-cy="PostCardHeadline" className="p-6 font-bold text-xl">
        {prettyDate(post.created)} <br /> {post.head}
      </h3>
    </div>
  );
}

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function prettyDate(dateValue: string) {
  const date = new Date(dateValue);
  const dayIndex = date.getDay();
  const dayName = days[dayIndex];
  const monthIndex = date.getMonth();
  const monthName = months[monthIndex];
  const year = date.getFullYear();
  const dateNumber = date.getDate();
  const time = date.toLocaleTimeString();
  return `${dayName}, ${dateNumber} ${monthName} ${year} ${time}`;
  // return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
