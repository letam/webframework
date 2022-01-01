import { lazy } from "react";

import PageNotFound from "components/PageNotFound";

const Index = lazy(async () => import("components/Index"));
const Login = lazy(async () => import("components/Login"));
const FruitDetails = lazy(async () => import("components/FruitDetails"));
const FruitGallery = lazy(async () => import("components/FruitGallery"));

const routes = [
  {
    path: "/",
    component: Index,
    exact: true,
  },
  {
    path: "*",
    component: PageNotFound,
  },
  {
    path: "/login",
    component: Login,
    exact: true,
  },
  {
    path: "/fruits",
    component: FruitGallery,
    exact: true,
  },
  {
    path: "/:fruitName",
    component: FruitDetails,
  },
];

export default routes;
