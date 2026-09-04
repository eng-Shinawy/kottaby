import type { Components, Theme } from "@mui/material/styles";
import {
  getMuiButton,
  getMuiButtonBase,
  getMuiCard,
  getMuiCssBaseline,
  getMuiDataGrid,
  getMuiIconButton,
  getMuiInputOverrides,
  getMuiPaper,
  getMuiSwitch,
  getMuiTypography,
} from "@/frontend/providers/theme/overrides";

export const components = (): Components<Omit<Theme, "components">> => {
  return {
    MuiCssBaseline: getMuiCssBaseline(),
    MuiButton: getMuiButton(),
    MuiButtonBase: getMuiButtonBase(),
    MuiIconButton: getMuiIconButton(),
    MuiPaper: getMuiPaper(),
    MuiCard: getMuiCard(),
    MuiSwitch: getMuiSwitch(),
    MuiTypography: getMuiTypography(),
    ...getMuiInputOverrides(),
    MuiDataGrid: getMuiDataGrid(),
  };
};
