import React, { ReactElement, ReactNode } from "react";
import { IPost } from "types";

function FormatText({ children }: { children: ReactNode }): ReactElement {
  // TODO: Handle unsafe post content / investigate hacks
  // TODO: If contains <script>, then do not set dangerously, and instead display button asking for permission.
  const markup = {
    __html: (children as string).replace(
      /(https?:[^ ]+) ?/g,
      '<a href="$1" target="_blank" style="text-decoration: underline; word-break: break-all;">$1</a>'
    ),
  };
  // eslint-disable-next-line react/no-danger
  return <div dangerouslySetInnerHTML={markup} />;
}

interface Properties {
  post: IPost;
}
export default function Post({ post }: Properties): ReactElement {
  return (
    <div data-cy="PostCard" tabIndex={0}>
      <h3 data-cy="PostCardHeadline" className="p-6 font-bold text-xl">
        {prettyDate(post.created)} <br /> <FormatText>{post.head}</FormatText>
      </h3>
    </div>
  );
}

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function prettyDate(dateValue: string) {
  const date = new Date(dateValue);
  const dayIndex = date.getDay();
  const dayName = days[dayIndex];
  const monthIndex = date.getMonth();
  const monthName = months[monthIndex];
  const year = date.getFullYear();
  const dateNumber = date.getDate();
  // const time = date.toLocaleTimeString();
  const hours = `${date.getHours() < 10 ? "0" : ""}${date.getHours()}`;
  const minutes = `${date.getMinutes() < 10 ? "0" : ""}${date.getMinutes()}`;
  const time = `${hours}:${minutes}`;
  return `${dayName}, ${dateNumber} ${monthName} ${year} ${time}`;
  // return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
