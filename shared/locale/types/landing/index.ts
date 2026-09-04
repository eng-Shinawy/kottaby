/**
 * Landing page i18n labels — marketing copy for the public landing page at `/`.
 *
 * This is the front door of the academy — the first page every anonymous
 * visitor sees. All strings are bilingual (EN + AR) and render RTL when the
 * active locale is Arabic.
 */

export interface LandingLabels {
  // Top nav
  readonly navSignIn: string;
  readonly navGetStarted: string;

  // Hero
  readonly heroBadge: string;
  readonly heroTitle: string;
  readonly heroTitleAccent: string;
  readonly heroSubtitle: string;
  readonly heroCtaPrimary: string;
  readonly heroCtaSecondary: string;

  // Stats bar
  readonly statsTeachers: string;
  readonly statsTeachersLabel: string;
  readonly statsStudents: string;
  readonly statsStudentsLabel: string;
  readonly statsRecitations: string;
  readonly statsRecitationsLabel: string;
  readonly statsCountries: string;
  readonly statsCountriesLabel: string;

  // Features section
  readonly featuresBadge: string;
  readonly featuresTitle: string;
  readonly featuresSubtitle: string;
  readonly featureVerifiedTitle: string;
  readonly featureVerifiedBody: string;
  readonly featureRecitationsTitle: string;
  readonly featureRecitationsBody: string;
  readonly featureProgressTitle: string;
  readonly featureProgressBody: string;
  readonly featureSecureTitle: string;
  readonly featureSecureBody: string;
  readonly featureSchedulingTitle: string;
  readonly featureSchedulingBody: string;
  readonly featurePaymentsTitle: string;
  readonly featurePaymentsBody: string;

  // Recitations showcase
  readonly recitationsBadge: string;
  readonly recitationsTitle: string;
  readonly recitationsSubtitle: string;

  // How it works
  readonly howBadge: string;
  readonly howTitle: string;
  readonly howSubtitle: string;
  readonly howStep1Title: string;
  readonly howStep1Body: string;
  readonly howStep2Title: string;
  readonly howStep2Body: string;
  readonly howStep3Title: string;
  readonly howStep3Body: string;

  // Roles section
  readonly rolesBadge: string;
  readonly rolesTitle: string;
  readonly rolesSubtitle: string;
  readonly roleStudentTitle: string;
  readonly roleStudentBody: string;
  readonly roleStudentCta: string;
  readonly roleTeacherTitle: string;
  readonly roleTeacherBody: string;
  readonly roleTeacherCta: string;
  readonly roleParentTitle: string;
  readonly roleParentBody: string;
  readonly roleParentCta: string;

  // Final CTA
  readonly ctaTitle: string;
  readonly ctaSubtitle: string;
  readonly ctaButton: string;

  // Testimonials section
  readonly testimonialsBadge: string;
  readonly testimonialsTitle: string;
  readonly testimonialsSubtitle: string;
  readonly testimonial1Quote: string;
  readonly testimonial1Name: string;
  readonly testimonial1Role: string;
  readonly testimonial2Quote: string;
  readonly testimonial2Name: string;
  readonly testimonial2Role: string;
  readonly testimonial3Quote: string;
  readonly testimonial3Name: string;
  readonly testimonial3Role: string;

  // FAQ section
  readonly faqBadge: string;
  readonly faqTitle: string;
  readonly faqSubtitle: string;
  readonly faq1Question: string;
  readonly faq1Answer: string;
  readonly faq2Question: string;
  readonly faq2Answer: string;
  readonly faq3Question: string;
  readonly faq3Answer: string;
  readonly faq4Question: string;
  readonly faq4Answer: string;
  readonly faq5Question: string;
  readonly faq5Answer: string;

  // Newsletter section
  readonly newsletterBadge: string;
  readonly newsletterTitle: string;
  readonly newsletterSubtitle: string;
  readonly newsletterPlaceholder: string;
  readonly newsletterButton: string;
  readonly newsletterDisclaimer: string;

  // Nav items (mobile menu)
  readonly navFeatures: string;
  readonly navRecitations: string;
  readonly navHowItWorks: string;
  readonly navRoles: string;
  readonly navTestimonials: string;
  readonly navFaq: string;
  readonly navPricing: string;
  readonly navContact: string;
  readonly navVerse: string;
  readonly navApp: string;

  // Trusted By / Partners section
  readonly partnersBadge: string;
  readonly partnersTitle: string;
  readonly partnersSubtitle: string;
  readonly partner1Name: string;
  readonly partner2Name: string;
  readonly partner3Name: string;
  readonly partner4Name: string;
  readonly partner5Name: string;
  readonly partner6Name: string;

  // Pricing section
  readonly pricingBadge: string;
  readonly pricingTitle: string;
  readonly pricingSubtitle: string;
  readonly pricingPlanFreeName: string;
  readonly pricingPlanFreePrice: string;
  readonly pricingPlanFreePriceNote: string;
  readonly pricingPlanFreeF1: string;
  readonly pricingPlanFreeF2: string;
  readonly pricingPlanFreeF3: string;
  readonly pricingPlanFreeF4: string;
  readonly pricingPlanFreeCta: string;
  readonly pricingPlanProName: string;
  readonly pricingPlanProPrice: string;
  readonly pricingPlanProPriceNote: string;
  readonly pricingPlanProF1: string;
  readonly pricingPlanProF2: string;
  readonly pricingPlanProF3: string;
  readonly pricingPlanProF4: string;
  readonly pricingPlanProF5: string;
  readonly pricingPlanProCta: string;
  readonly pricingPlanProPopular: string;
  readonly pricingPlanFamilyName: string;
  readonly pricingPlanFamilyPrice: string;
  readonly pricingPlanFamilyPriceNote: string;
  readonly pricingPlanFamilyF1: string;
  readonly pricingPlanFamilyF2: string;
  readonly pricingPlanFamilyF3: string;
  readonly pricingPlanFamilyF4: string;
  readonly pricingPlanFamilyF5: string;
  readonly pricingPlanFamilyF6: string;
  readonly pricingPlanFamilyCta: string;
  readonly pricingMonthly: string;

  // Pricing toggle
  readonly pricingToggleMonthly: string;
  readonly pricingToggleYearly: string;
  readonly pricingYearlyDiscount: string;
  readonly pricingPlanProPriceYearly: string;
  readonly pricingPlanFamilyPriceYearly: string;
  readonly pricingPlanFreePriceNoteYearly: string;
  readonly pricingPlanProPriceNoteYearly: string;
  readonly pricingPlanFamilyPriceNoteYearly: string;

  // Testimonial carousel
  readonly testimonialPrev: string;
  readonly testimonialNext: string;

  // Contact section
  readonly contactBadge: string;
  readonly contactTitle: string;
  readonly contactSubtitle: string;
  readonly contactEmailLabel: string;
  readonly contactEmailPlaceholder: string;
  readonly contactMessageLabel: string;
  readonly contactMessagePlaceholder: string;
  readonly contactButton: string;
  readonly contactSuccessMessage: string;

  // Cookie consent
  readonly cookieTitle: string;
  readonly cookieBody: string;
  readonly cookieAccept: string;
  readonly cookieDecline: string;
  readonly cookieSettings: string;

  // Verse of the Day section
  readonly verseBadge: string;
  readonly verseTitle: string;
  readonly verseSubtitle: string;
  readonly verseArabic: string;
  readonly verseTranslation: string;
  readonly verseReference: string;
  readonly verseSurah: string;

  // Mobile App section
  readonly appBadge: string;
  readonly appTitle: string;
  readonly appSubtitle: string;
  readonly appF1: string;
  readonly appF2: string;
  readonly appF3: string;
  readonly appF4: string;
  readonly appCtaAppStore: string;
  readonly appCtaPlayStore: string;

  // Footer
  readonly footerTagline: string;
  readonly footerProduct: string;
  readonly footerProductFeatures: string;
  readonly footerProductRecitations: string;
  readonly footerProductPricing: string;
  readonly footerCompany: string;
  readonly footerCompanyAbout: string;
  readonly footerCompanyCareers: string;
  readonly footerCompanyContact: string;
  readonly footerLegal: string;
  readonly footerLegalPrivacy: string;
  readonly footerLegalTerms: string;
  readonly footerLegalCookies: string;
  readonly footerCopyright: string;
  readonly footerSocialX: string;
  readonly footerSocialYoutube: string;
  readonly footerSocialInstagram: string;
  readonly footerSocialTelegram: string;
  readonly footerSocialFacebook: string;

  // Footer live API-status chip
  readonly footerStatusLabel: string;
  readonly footerStatusChecking: string;
  readonly footerStatusOperational: string;
  readonly footerStatusOffline: string;

  // Achievements section
  readonly achievementsBadge: string;
  readonly achievementsTitle: string;
  readonly achievementsSubtitle: string;
  readonly achievement1Label: string;
  readonly achievement1Value: string;
  readonly achievement2Label: string;
  readonly achievement2Value: string;
  readonly achievement3Label: string;
  readonly achievement3Value: string;
  readonly achievement4Label: string;
  readonly achievement4Value: string;
  readonly achievement5Label: string;
  readonly achievement5Value: string;
  readonly achievement6Label: string;
  readonly achievement6Value: string;
  // Curriculum Roadmap section
  readonly curriculumBadge: string;
  readonly curriculumTitle: string;
  readonly curriculumSubtitle: string;
  readonly curriculumStep1: string;
  readonly curriculumStep1Desc: string;
  readonly curriculumStep2: string;
  readonly curriculumStep2Desc: string;
  readonly curriculumStep3: string;
  readonly curriculumStep3Desc: string;
  readonly curriculumStep4: string;
  readonly curriculumStep4Desc: string;
  readonly curriculumStep5: string;
  readonly curriculumStep5Desc: string;
  // Recitation search
  readonly recitationSearchPlaceholder: string;
  readonly recitationNoResults: string;
  // Cookie Settings dialog
  readonly cookieDialogTitle: string;
  readonly cookieDialogBody: string;
  readonly cookieDialogNecessary: string;
  readonly cookieDialogNecessaryDesc: string;
  readonly cookieDialogAnalytics: string;
  readonly cookieDialogAnalyticsDesc: string;
  readonly cookieDialogMarketing: string;
  readonly cookieDialogMarketingDesc: string;
  readonly cookieDialogSave: string;
  // Share verse
  readonly verseShare: string;
  readonly verseCopy: string;
  readonly verseCopied: string;
  // Active section nav highlight
  readonly navAchievements: string;
  readonly navCurriculum: string;
  // Hero live indicator
  readonly heroLiveLabel: string;
  // Accessibility labels (icon-only controls)
  readonly a11yToggleColorMode: string;
  readonly a11yToggleMenu: string;
  // Newsletter & contact validation
  readonly newsletterError: string;
  readonly newsletterSuccess: string;
  readonly contactEmailError: string;
  readonly contactMessageError: string;
  // FAQ expand/collapse
  readonly faqExpandAll: string;
  readonly faqCollapseAll: string;
  // Teacher Spotlight section
  readonly teachersBadge: string;
  readonly teachersTitle: string;
  readonly teachersSubtitle: string;
  readonly teacher1Name: string;
  readonly teacher1Specialty: string;
  readonly teacher1Location: string;
  readonly teacher2Name: string;
  readonly teacher2Specialty: string;
  readonly teacher2Location: string;
  readonly teacher3Name: string;
  readonly teacher3Specialty: string;
  readonly teacher3Location: string;
  readonly teacher4Name: string;
  readonly teacher4Specialty: string;
  readonly teacher4Location: string;
  readonly teacherBookSession: string;
  readonly teacherSessionsCount: string;
  readonly teacherRating: string;
  // Resources section
  readonly resourcesBadge: string;
  readonly resourcesTitle: string;
  readonly resourcesSubtitle: string;
  readonly resource1Title: string;
  readonly resource1Category: string;
  readonly resource1Date: string;
  readonly resource1Excerpt: string;
  readonly resource2Title: string;
  readonly resource2Category: string;
  readonly resource2Date: string;
  readonly resource2Excerpt: string;
  readonly resource3Title: string;
  readonly resource3Category: string;
  readonly resource3Date: string;
  readonly resource3Excerpt: string;
  readonly resourceReadMore: string;
  // WhatsApp floating button
  readonly whatsappTooltip: string;
  readonly whatsappA11y: string;
  // Nav
  readonly navTeachers: string;
  readonly navResources: string;
  // Accessibility labels (navigation helpers)
  readonly a11yBackToTop: string;
  readonly a11ySkipToContent: string;
  // Hijri date & prayer-times strip (Cairo)
  readonly hijriStripAriaLabel: string;
  readonly hijriToday: string;
  readonly prayerFajr: string;
  readonly prayerSunrise: string;
  readonly prayerDhuhr: string;
  readonly prayerAsr: string;
  readonly prayerMaghrib: string;
  readonly prayerIsha: string;
  readonly prayerNext: string;
  readonly prayerIn: string;

  // Global 404 page (app/not-found.tsx) — public surface, branded + RTL-aware
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly notFoundBackHome: string;
  readonly notFoundMetaTitle: string;
  readonly notFoundMetaDescription: string;
}
