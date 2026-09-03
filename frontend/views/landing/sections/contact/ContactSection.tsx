"use client";

import { Alert, Box, Snackbar, Stack, Typography } from "@mui/material";
import { type ReactNode, type SyntheticEvent, useState } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { ContactEmailField, ContactMessageField } from "@/frontend/views/landing/sections/contact/ContactFields";
import { ContactSubmitButton } from "@/frontend/views/landing/sections/contact/ContactSubmitButton";
import { isEmailLike } from "@/frontend/views/landing/utils";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Contact section ────────────────────────────────────────────────

export function ContactSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [snackOpen, setSnackOpen] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [messageError, setMessageError] = useState(false);

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    let valid = true;
    if (!isEmailLike(email)) {
      setEmailError(true);
      valid = false;
    } else {
      setEmailError(false);
    }
    if (message.length < 10) {
      setMessageError(true);
      valid = false;
    } else {
      setMessageError(false);
    }
    if (!valid) return;
    setEmail("");
    setMessage("");
    setSnackOpen(true);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setEmailError(false);
  };

  const handleMessageChange = (value: string) => {
    setMessage(value);
    setMessageError(false);
  };

  return (
    <SectionWrapper badge={t.contactBadge} title={t.contactTitle} subtitle={t.contactSubtitle} bg="default">
      <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 600, mx: "auto" }}>
        <Stack spacing={2.5}>
          <ContactEmailField email={email} emailError={emailError} onChange={handleEmailChange} />
          <ContactMessageField message={message} messageError={messageError} onChange={handleMessageChange} />
          <Typography
            variant="caption"
            sx={{
              alignSelf: "flex-end",
              color: message.length > 450 ? "var(--mui-palette-warning-main)" : "var(--mui-palette-text-secondary)",
              opacity: 0.7,
            }}
          >
            {message.length}/500
          </Typography>
          <ContactSubmitButton />
        </Stack>
      </Box>

      <Snackbar
        open={snackOpen}
        autoHideDuration={5000}
        onClose={() => setSnackOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnackOpen(false)}
          severity="success"
          sx={{
            borderRadius: 2,
            fontWeight: 600,
          }}
        >
          {t.contactSuccessMessage}
        </Alert>
      </Snackbar>
    </SectionWrapper>
  );
}
