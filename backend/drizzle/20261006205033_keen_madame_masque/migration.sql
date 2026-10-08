DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_anam'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_anam';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_araf'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_araf';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_anfal'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_anfal';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_tawbah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_tawbah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_yunus'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_yunus';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_hud'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_hud';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_yusuf'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_yusuf';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ar_rad'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ar_rad';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ibrahim'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ibrahim';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_hijr'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_hijr';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_nahl'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_nahl';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_isra'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_isra';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_kahf'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_kahf';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_maryam'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_maryam';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ta_ha'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ta_ha';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_anbiya'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_anbiya';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_hajj'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_hajj';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_muminun'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_muminun';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_nur'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_nur';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_furqan'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_furqan';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ash_shuara'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ash_shuara';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_naml'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_naml';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_qasas'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_qasas';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_ankabut'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_ankabut';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ar_rum'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ar_rum';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_luqman'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_luqman';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_as_sajdah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_as_sajdah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_ahzab'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_ahzab';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_saba'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_saba';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_fatir'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_fatir';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ya_sin'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ya_sin';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_as_saffat'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_as_saffat';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_sad'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_sad';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_az_zumar'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_az_zumar';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ghafir'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ghafir';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_fussilat'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_fussilat';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ash_shura'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ash_shura';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_az_zukhruf'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_az_zukhruf';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ad_dukhan'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ad_dukhan';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_jathiyah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_jathiyah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_ahqaf'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_ahqaf';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_muhammad'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_muhammad';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_fath'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_fath';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_hujurat'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_hujurat';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_qaf'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_qaf';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ad_dhariyat'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ad_dhariyat';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_tur'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_tur';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_najm'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_najm';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_qamar'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_qamar';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ar_rahman'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ar_rahman';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_waqiah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_waqiah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_hadid'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_hadid';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_mujadilah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_mujadilah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_hashr'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_hashr';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_mumtahanah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_mumtahanah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_as_saff'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_as_saff';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_jumuah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_jumuah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_munafiqun'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_munafiqun';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_taghabun'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_taghabun';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_talaq'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_talaq';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_tahrim'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_tahrim';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_mulk'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_mulk';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_qalam'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_qalam';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_haqqah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_haqqah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_maarij'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_maarij';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_nuh'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_nuh';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_jinn'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_jinn';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_muzzammil'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_muzzammil';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_muddaththir'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_muddaththir';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_qiyamah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_qiyamah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_insan'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_insan';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_mursalat'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_mursalat';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_naba'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_naba';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_naziat'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_naziat';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_abasa'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_abasa';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_takwir'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_takwir';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_infitar'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_infitar';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_mutaffifin'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_mutaffifin';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_inshiqaq'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_inshiqaq';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_buruj'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_buruj';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_tariq'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_tariq';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_ala'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_ala';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_ghashiyah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_ghashiyah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_fajr'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_fajr';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_balad'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_balad';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ash_shams'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ash_shams';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_layl'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_layl';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ad_duha'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ad_duha';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_ash_sharh'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_ash_sharh';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_tin'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_tin';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_alaq'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_alaq';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_qadr'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_qadr';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_bayyinah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_bayyinah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_az_zalzalah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_az_zalzalah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_adiyat'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_adiyat';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_qariah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_qariah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_at_takathur'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_at_takathur';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_asr'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_asr';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_humazah'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_humazah';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_fil'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_fil';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_quraysh'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_quraysh';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_maun'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_maun';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_kawthar'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_kawthar';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_kafirun'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_kafirun';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_nasr'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_nasr';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_masad'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_masad';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_ikhlas'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_ikhlas';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_al_falaq'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_al_falaq';
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'surah_juz_ref' AND e.enumlabel = 'surah_an_nas'
    ) THEN
        ALTER TYPE "surah_juz_ref" ADD VALUE 'surah_an_nas';
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "re_evaluation_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "teacher" ADD COLUMN IF NOT EXISTS "recitations" varchar(255);--> statement-breakpoint
ALTER TABLE "teacher" ADD COLUMN IF NOT EXISTS "languages" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_teacher_id_status_idx" ON "session" ("teacher_id","status");