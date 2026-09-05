import { alpha, type Components, type Theme } from "@mui/material/styles";

export const getMuiDataGrid = (): Components<Omit<Theme, "components">>["MuiDataGrid"] => ({
  styleOverrides: {
    root: ({ theme }) => ({
      border: "none",
      "--DataGrid-containerBackground": "transparent",
      "& .MuiDataGrid-columnHeader": {
        backgroundColor: theme.palette.surfaceContainerLow,
      },
      "& .MuiDataGrid-columnHeaderTitle": {
        fontFamily: "var(--font-inter), sans-serif",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: theme.palette.onSurfaceVariant,
      },
      // Cells default to display:block; without flex, plain text sticks to the top
      // while taller renderCell content (avatars, icon buttons) sits mid-row.
      "& .MuiDataGrid-cell": {
        display: "flex",
        alignItems: "center",
        borderBottom: `1px solid`,
        borderColor: theme.palette.border.light,
      },
      "& .MuiDataGrid-row:hover": {
        backgroundColor:
          theme.palette.mode === "light"
            ? alpha(theme.palette.primary.main, 0.04)
            : alpha(theme.palette.primary.main, 0.06),
      },
      "& .MuiDataGrid-footerContainer": {
        borderTop: `1px solid`,
        borderColor: theme.palette.border.light,
      },
    }),
  },
});
