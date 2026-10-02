import * as React from "react";
import type { SvgProps } from "react-native-svg";
import Svg, { Path, Text } from "react-native-svg";
import { SCOLA_BRAND } from "@/constants/scolaBrand";

const ScolaLogo = (props: SvgProps) => {
  const color = props.fill ? String(props.fill) : SCOLA_BRAND.blue;

  return (
    <Svg width={148} height={32} viewBox="0 0 148 32" {...props}>
      <Path
        d="M3 6c4-2 10-2 14 1l8 5 8-5c4-3 10-3 14-1v20c-5-2-10-2-14 1l-8 4-8-4c-4-3-9-3-14-1zM25 12v18"
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Text
        x={54}
        y={25}
        fill={color}
        fontSize={25}
        fontWeight="700"
        fontFamily="Arial"
      >
        Scola
      </Text>
    </Svg>
  );
};

export default ScolaLogo;
