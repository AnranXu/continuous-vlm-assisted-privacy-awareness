#!/usr/bin/env Rscript
#
# analyzer/power_analysis.R
#
# Power analysis helper for the Continuous VLM-assisted Privacy Awareness study.
#
# Mirrors the logic of `analyzer/power_analysis.py` (normal approximation):
#   - Independent two-group comparison (human vs vlm), optional unequal allocation ratio
#   - Optional paired design
#   - Optionally estimate effect size (Cohen's d / Hedges' g) from a pilot CSV
#   - Optional dropout inflation
#   - Optional conversion to per-story capacity (repo assignment model)
#   - Optional printing of DynamoDB capacity CSV lines
#
# Examples:
#   Rscript analyzer/power_analysis.R --effect 0.5 --alpha 0.05 --power 0.80
#   Rscript analyzer/power_analysis.R --pilot-csv pilot_outcome.csv --pilot-group-col mode --pilot-value-col outcome
#   Rscript analyzer/power_analysis.R --effect 0.5 --dropout-rate 0.10
#   Rscript analyzer/power_analysis.R --effect 0.5 --study-config annotation_json/study_config.json
#   Rscript analyzer/power_analysis.R --effect 0.5 --study-label formal_1 --print-ddb-csv

parse_args <- function(argv) {
  args <- list()
  i <- 1
  while (i <= length(argv)) {
    key <- argv[[i]]
    if (!startsWith(key, "--")) {
      stop(paste0("Unexpected arg: ", key))
    }
    key <- sub("^--", "", key)
    if (i == length(argv) || startsWith(argv[[i + 1]], "--")) {
      args[[key]] <- TRUE
      i <- i + 1
      next
    }
    args[[key]] <- argv[[i + 1]]
    i <- i + 2
  }
  args
}

get_arg <- function(args, name, default = NULL) {
  if (!is.null(args[[name]])) return(args[[name]])
  default
}

as_num <- function(x, name) {
  if (is.null(x)) return(NULL)
  v <- suppressWarnings(as.numeric(x))
  if (is.na(v)) stop(paste0("Invalid numeric for --", name, ": ", x))
  v
}

as_int <- function(x, name) {
  if (is.null(x)) return(NULL)
  v <- suppressWarnings(as.integer(x))
  if (is.na(v)) stop(paste0("Invalid integer for --", name, ": ", x))
  v
}

required_n_independent <- function(effect_size_d, alpha = 0.05, power = 0.80, two_sided = TRUE, allocation_ratio = 1.0) {
  if (effect_size_d <= 0) stop("effect_size_d must be > 0")
  if (!(alpha > 0 && alpha < 1)) stop("alpha must be in (0,1)")
  if (!(power > 0 && power < 1)) stop("power must be in (0,1)")
  if (!(allocation_ratio > 0)) stop("allocation_ratio must be > 0")

  alpha_tail <- if (two_sided) alpha / 2 else alpha
  z_alpha <- qnorm(1 - alpha_tail)
  z_power <- qnorm(power)
  z_sum_sq <- (z_alpha + z_power) ^ 2

  r <- allocation_ratio # n_vlm / n_human
  n_human <- ((1 + r) / r) * z_sum_sq / (effect_size_d ^ 2)
  n_vlm <- r * n_human
  c(ceiling(n_human), ceiling(n_vlm))
}

required_n_paired <- function(effect_size_dz, alpha = 0.05, power = 0.80, two_sided = TRUE) {
  if (effect_size_dz <= 0) stop("effect_size_dz must be > 0")
  if (!(alpha > 0 && alpha < 1)) stop("alpha must be in (0,1)")
  if (!(power > 0 && power < 1)) stop("power must be in (0,1)")

  alpha_tail <- if (two_sided) alpha / 2 else alpha
  z_alpha <- qnorm(1 - alpha_tail)
  z_power <- qnorm(power)
  n <- ((z_alpha + z_power) / effect_size_dz) ^ 2
  ceiling(n)
}

apply_dropout <- function(n, dropout_rate) {
  if (!(dropout_rate >= 0 && dropout_rate < 1)) stop("dropout-rate must be in [0,1)")
  if (dropout_rate == 0) return(as.integer(n))
  as.integer(ceiling(n / (1 - dropout_rate)))
}

pooled_sd <- function(sd_a, sd_b, n_a, n_b) {
  if (n_a < 2 || n_b < 2) stop("Need at least 2 observations per group to compute pooled SD.")
  df <- (n_a - 1) + (n_b - 1)
  sqrt(((n_a - 1) * sd_a ^ 2 + (n_b - 1) * sd_b ^ 2) / df)
}

pilot_effect <- function(pilot_csv, group_col = "mode", value_col = "outcome", group_a = "human", group_b = "vlm") {
  df <- read.csv(pilot_csv, stringsAsFactors = FALSE)
  if (!(group_col %in% names(df))) stop(paste0("pilot CSV missing column: ", group_col))
  if (!(value_col %in% names(df))) stop(paste0("pilot CSV missing column: ", value_col))

  df[[group_col]] <- trimws(as.character(df[[group_col]]))
  vals <- suppressWarnings(as.numeric(df[[value_col]]))
  df[[value_col]] <- vals
  df <- df[!is.na(df[[value_col]]), , drop = FALSE]

  a <- df[df[[group_col]] == group_a, , drop = FALSE][[value_col]]
  b <- df[df[[group_col]] == group_b, , drop = FALSE][[value_col]]
  if (length(a) < 2 || length(b) < 2) {
    stop(paste0("Need >=2 rows per group in pilot CSV for groups: ", group_a, ", ", group_b))
  }

  mean_a <- mean(a)
  mean_b <- mean(b)
  sd_a <- sd(a)
  sd_b <- sd(b)
  psd <- pooled_sd(sd_a, sd_b, length(a), length(b))
  d <- (mean_b - mean_a) / psd
  dfree <- (length(a) - 1) + (length(b) - 1)
  J <- 1 - 3 / (4 * dfree - 1)
  g <- J * d

  list(
    group_a = group_a,
    group_b = group_b,
    n_a = length(a),
    n_b = length(b),
    mean_a = mean_a,
    mean_b = mean_b,
    sd_a = sd_a,
    sd_b = sd_b,
    pooled_sd = psd,
    cohens_d = d,
    hedges_g = g
  )
}

load_story_ids_from_study_config <- function(path) {
  if (!file.exists(path)) stop(paste0("study-config not found: ", path))
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("Package 'jsonlite' is required to read study_config.json. Install with: install.packages('jsonlite')")
  }
  data <- jsonlite::fromJSON(path)
  stories <- data$stories
  if (is.null(stories) || length(stories) == 0) stop(paste0("No stories found in ", path))
  ids <- vapply(stories, function(s) {
    sid <- s$storyId
    if (is.null(sid)) return(NA_character_)
    trimws(as.character(sid))
  }, character(1))
  ids <- ids[!is.na(ids) & nzchar(ids)]
  if (length(ids) == 0) stop(paste0("No storyId fields found in ", path))
  ids
}

story_capacity_per_mode <- function(n_per_mode, story_count) {
  if (story_count <= 0) stop("story_count must be >= 1")
  as.integer(ceiling(n_per_mode / story_count))
}

emit_ddb_capacity_csv_lines <- function(study_label, story_ids, max_assignments_per_story_per_mode, modes = c("human", "vlm")) {
  header <- "\"pk\",\"sk\",\"analysis_filename\",\"assigned_count\",\"item_type\",\"max_assignments\",\"mode\",\"story_id\",\"study\""
  lines <- c(header)
  for (story_id in story_ids) {
    for (mode in modes) {
      sk <- paste0(study_label, "#", story_id, "#", mode)
      analysis_filename <- paste0(story_id, ".json")
      lines <- c(
        lines,
        paste0(
          "\"soups26_vlm_assignment_story\",\"",
          sk,
          "\",\"",
          analysis_filename,
          "\",\"0\",\"story_capacity\",\"",
          max_assignments_per_story_per_mode,
          "\",\"",
          mode,
          "\",\"",
          story_id,
          "\",\"",
          study_label,
          "\""
        )
      )
    }
  }
  lines
}

main <- function() {
  args <- parse_args(commandArgs(trailingOnly = TRUE))

  design <- tolower(get_arg(args, "design", "independent"))
  alpha <- as_num(get_arg(args, "alpha", "0.05"), "alpha")
  power <- as_num(get_arg(args, "power", "0.80"), "power")
  one_sided <- isTRUE(get_arg(args, "one-sided", FALSE)) || isTRUE(get_arg(args, "one_sided", FALSE))
  two_sided <- !one_sided
  allocation_ratio <- as_num(get_arg(args, "allocation-ratio", "1.0"), "allocation-ratio")
  dropout_rate <- as_num(get_arg(args, "dropout-rate", "0.0"), "dropout-rate")

  effect <- as_num(get_arg(args, "effect", NULL), "effect")
  pilot_csv <- get_arg(args, "pilot-csv", NULL)
  pilot_group_col <- get_arg(args, "pilot-group-col", "mode")
  pilot_value_col <- get_arg(args, "pilot-value-col", "outcome")
  pilot_group_a <- get_arg(args, "pilot-group-a", "human")
  pilot_group_b <- get_arg(args, "pilot-group-b", "vlm")
  use_hedges_g <- isTRUE(get_arg(args, "use-hedges-g", FALSE)) || isTRUE(get_arg(args, "use_hedges_g", FALSE))

  pilot_summary <- NULL
  if (is.null(effect) && !is.null(pilot_csv)) {
    pilot_summary <- pilot_effect(
      pilot_csv,
      group_col = pilot_group_col,
      value_col = pilot_value_col,
      group_a = pilot_group_a,
      group_b = pilot_group_b
    )
    effect <- if (use_hedges_g) pilot_summary$hedges_g else pilot_summary$cohens_d
  }
  if (is.null(effect) || abs(effect) <= 0) stop("Provide --effect (non-zero) or --pilot-csv to estimate an effect size.")

  abs_effect <- abs(effect)

  if (design == "independent") {
    ns <- required_n_independent(
      effect_size_d = abs_effect,
      alpha = alpha,
      power = power,
      two_sided = two_sided,
      allocation_ratio = allocation_ratio
    )
    n_human <- apply_dropout(ns[[1]], dropout_rate)
    n_vlm <- apply_dropout(ns[[2]], dropout_rate)
    n_total <- n_human + n_vlm
  } else if (design == "paired") {
    n_pairs <- apply_dropout(required_n_paired(abs_effect, alpha = alpha, power = power, two_sided = two_sided), dropout_rate)
    n_human <- 0
    n_vlm <- 0
    n_total <- n_pairs
  } else {
    stop("Unsupported --design (use independent or paired).")
  }

  stories <- as_int(get_arg(args, "stories", NULL), "stories")
  study_config <- get_arg(args, "study-config", "annotation_json/study_config.json")
  study_label <- get_arg(args, "study-label", "formal_1")
  print_ddb_csv <- isTRUE(get_arg(args, "print-ddb-csv", FALSE)) || isTRUE(get_arg(args, "print_ddb_csv", FALSE))

  story_ids <- NULL
  story_count <- stories
  if (is.null(story_count) && !is.null(study_config) && file.exists(study_config)) {
    story_ids <- tryCatch(load_story_ids_from_study_config(study_config), error = function(e) NULL)
    if (!is.null(story_ids)) story_count <- length(story_ids)
  }

  cat("=== Power analysis (normal approx) ===\n")
  cat(sprintf("design: %s\n", design))
  cat(sprintf("alpha: %0.4f (%s)\n", alpha, if (two_sided) "two-sided" else "one-sided"))
  cat(sprintf("power: %0.2f\n", power))
  cat(sprintf("effect size: %0.4f (%s)\n", abs_effect, if (use_hedges_g) "Hedges g" else "Cohen d/dz"))
  if (!is.null(dropout_rate) && dropout_rate > 0) {
    cat(sprintf("dropout-rate: %0.2f%% (inflated)\n", dropout_rate * 100))
  }

  if (!is.null(pilot_summary)) {
    cat("--- Pilot summary used to estimate effect ---\n")
    cat(sprintf("%s: n=%d, mean=%0.4f, sd=%0.4f\n", pilot_summary$group_a, pilot_summary$n_a, pilot_summary$mean_a, pilot_summary$sd_a))
    cat(sprintf("%s: n=%d, mean=%0.4f, sd=%0.4f\n", pilot_summary$group_b, pilot_summary$n_b, pilot_summary$mean_b, pilot_summary$sd_b))
    cat(sprintf("pooled_sd: %0.4f\n", pilot_summary$pooled_sd))
    cat(sprintf("cohens_d: %0.4f\n", pilot_summary$cohens_d))
    cat(sprintf("hedges_g: %0.4f\n", pilot_summary$hedges_g))
  }

  cat("--- Required sample size ---\n")
  if (design == "independent") {
    cat(sprintf("n_per_group (human): %d\n", n_human))
    cat(sprintf("n_per_group (vlm):   %d  (allocation ratio n_vlm/n_human=%g)\n", n_vlm, allocation_ratio))
    cat(sprintf("n_total:             %d\n", n_total))
  } else {
    cat(sprintf("n_total_pairs:       %d\n", n_total))
  }

  if (design == "independent" && !is.null(story_count) && story_count > 0) {
    per_story <- story_capacity_per_mode(max(n_human, n_vlm), story_count)
    implied_total <- per_story * story_count * 2
    cat("--- Convert to per-story capacity (repo assignment model) ---\n")
    cat(sprintf("stories:                       %d\n", story_count))
    cat(sprintf("max_assignments per story/mode: %d\n", per_story))
    cat(sprintf("implied total capacity:        %d (>= %d)\n", implied_total, n_total))

    if (print_ddb_csv) {
      if (is.null(story_ids)) {
        story_ids <- sprintf("story_%02d", seq_len(story_count))
      }
      cat("--- DynamoDB capacity CSV (paste/append) ---\n")
      lines <- emit_ddb_capacity_csv_lines(
        study_label = study_label,
        story_ids = story_ids,
        max_assignments_per_story_per_mode = per_story
      )
      cat(paste(lines, collapse = "\n"))
      cat("\n")
    }
  }
}

main()

