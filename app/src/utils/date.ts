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

function prettyDate(dateValue: string): string {
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

export { prettyDate };
