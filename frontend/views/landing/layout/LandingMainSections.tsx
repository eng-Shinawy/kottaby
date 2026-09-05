import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { FadeInBox, IslamicDivider } from "@/frontend/views/landing/layout";
import {
  AchievementsSection,
  ContactSection,
  CtaSection,
  CurriculumSection,
  FaqSection,
  FeaturesSection,
  HowItWorksSection,
  MobileAppSection,
  NewsletterSection,
  PartnersSection,
  PricingSection,
  RecitationsSection,
  ResourcesSection,
  RolesSection,
  StatsBar,
  TeacherSpotlightSection,
  TestimonialsSection,
  VerseSection,
} from "@/frontend/views/landing/sections";

/** The `<main>` scroll body: all fade-in landing sections in anchor order. */
export function LandingMainSections(): ReactNode {
  return (
    <Box component="main" id="main-content">
      <VerseSection />
      <FadeInBox>
        <StatsBar />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox>
        <PartnersSection />
      </FadeInBox>
      <FadeInBox id="features">
        <FeaturesSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="recitations">
        <RecitationsSection />
      </FadeInBox>
      <FadeInBox id="curriculum">
        <CurriculumSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="how-it-works">
        <HowItWorksSection />
      </FadeInBox>
      <FadeInBox id="achievements">
        <AchievementsSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="teachers">
        <TeacherSpotlightSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="roles">
        <RolesSection />
      </FadeInBox>
      <FadeInBox id="pricing">
        <PricingSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="testimonials">
        <TestimonialsSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="resources">
        <ResourcesSection />
      </FadeInBox>
      <FadeInBox id="faq">
        <FaqSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="newsletter">
        <NewsletterSection />
      </FadeInBox>
      <FadeInBox id="contact">
        <ContactSection />
      </FadeInBox>
      <IslamicDivider />
      <FadeInBox id="app">
        <MobileAppSection />
      </FadeInBox>
      <FadeInBox>
        <CtaSection />
      </FadeInBox>
    </Box>
  );
}
