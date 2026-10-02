import { t } from "i18next";
import { SCOLA_BRAND } from "@/constants/scolaBrand";

export enum Colors {
  PINK,
  YELLOW,
  GREEN,
  PURPLE,
  BLUE,
  BLACK,
}

export const AppColors = [
  {
    mainColor: SCOLA_BRAND.blue,
    backgroundColor: "#E7EEFF",
    nameKey: "Bleu",
    colorEnum: Colors.BLUE,
  },
  {
    mainColor: SCOLA_BRAND.yellow,
    backgroundColor: "#FFF5D9",
    nameKey: "Jaune",
    colorEnum: Colors.YELLOW,
  },
  {
    mainColor: "#26B290",
    backgroundColor: "#DEF3EE",
    nameKey: "Vert",
    colorEnum: Colors.GREEN,
  },
  {
    mainColor: SCOLA_BRAND.violet,
    backgroundColor: "#EFE8FF",
    nameKey: "Violet",
    colorEnum: Colors.PURPLE,
  },
  {
    mainColor: SCOLA_BRAND.coral,
    backgroundColor: "#FCE8ED",
    nameKey: "Rose",
    colorEnum: Colors.PINK,
  },
  {
    mainColor: SCOLA_BRAND.navy,
    backgroundColor: "#E9EDF6",
    nameKey: "Noir",
    colorEnum: Colors.BLACK,
  },
];
