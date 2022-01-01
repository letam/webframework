import { lazy } from "react";

import PageNotFound from "components/PageNotFound";

const Index = lazy(() => import("components/Index"));
const Login = lazy(() => import("components/Login"));
const FruitDetails = lazy(() => import("components/FruitDetails"));
const FruitGallery = lazy(() => import("components/FruitGallery"));

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
