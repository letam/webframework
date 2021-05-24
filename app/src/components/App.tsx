import React, { lazy, ReactElement, Suspense } from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import LoadingOrError from "./LoadingOrError";

const Index = lazy(() => import("./Index"));
const Login = lazy(() => import("./Login"));
const FruitDetails = lazy(() => import("./FruitDetails"));
const FruitGallery = lazy(() => import("./FruitGallery"));

export default function App(): ReactElement {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingOrError />}>
        <Switch>
          <Route exact path="/" component={Index} />
          <Route exact path="/login" component={Login} />
          <Route exact path="/fruits" component={FruitGallery} />
          <Route path="/:fruitName" component={FruitDetails} />
        </Switch>
      </Suspense>
    </BrowserRouter>
  );
}
