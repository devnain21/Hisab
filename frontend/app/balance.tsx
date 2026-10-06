import { Redirect } from "expo-router";

/** Old links to the total balance land on Reports, which now shows both accounts. */
export default function BalanceScreen() {
  return <Redirect href={"/report" as never} />;
}
