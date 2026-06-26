#!/usr/bin/env bash

set +e

# Set test environment to reduce Telegram notification logs pollution
export NODE_ENV=test

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/test_run_${TIMESTAMP}.log"

SLEEP_SECONDS=5

if [[ "$1" == "--fast" ]]; then
SLEEP_SECONDS=0
fi

TESTS=(
"milestones/test_milestone1.js"
"milestones/test_milestone2.js"
"milestones/test_milestone3.js"
"milestones/test_milestone4.js"
"milestones/test_milestone5.js"
"milestones/test_milestone6.js"
"milestones/test_milestone7.js"
"milestones/test_milestone8.js"
"milestones/test_milestone_p3_m1.js"
"milestones/test_milestone_p3_m2.js"
"milestones/test_milestone_p3_m3.js"
"milestones/test_milestone_p3_m4.js"
"milestones/test_milestone_p3_m5.js"

"milestones/test_milestone_p4_m1.js"
"milestones/test_milestone_p4_m2.js"
"milestones/test_milestone_p4_m3.js"
"milestones/test_milestone_p4_m4.js"
"milestones/test_milestone_p4_m5.js"

"phase2/test_phase2.js"
"phase2/test_phase2a.js"

"hardening/test_concurrency.js"
"hardening/test_security_definer.js"
"hardening/test_estimate_amount_matrix.js"
"hardening/test_failure_injection.js"
"hardening/test_performance.js"

)

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

PASSED_TESTS=()
WARNING_TESTS=()
FAILED_TESTS=()
STATS=()

TOTAL_START=$(date +%s)

echo "======================================================" | tee "$LOG_FILE"
echo "SN POLYMERS BACKEND TEST RUNNER" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "======================================================" | tee -a "$LOG_FILE"

for TEST in "${TESTS[@]}"
do
echo "" | tee -a "$LOG_FILE"
echo "------------------------------------------------------" | tee -a "$LOG_FILE"
echo "RUNNING: $TEST" | tee -a "$LOG_FILE"
echo "------------------------------------------------------" | tee -a "$LOG_FILE"

START=$(date +%s)
TEST_LOG_FILE=$(mktemp)
node "$ROOT_DIR/$TEST" 2>&1 | tee "$TEST_LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

cat "$TEST_LOG_FILE" >> "$LOG_FILE"

# Check for warnings in this test output
WARNING_FOUND=0
if grep -vE "Failed: 0|Passed:|Unauthorized|Access denied|not found|numeric field overflow|Expected Under ZO Review|undecided rows|Telegram notification failed" "$TEST_LOG_FILE" | grep -qiE "failed:|error:|exception:|TypeError|ReferenceError|AssertionError"; then
    WARNING_FOUND=1
fi
rm -f "$TEST_LOG_FILE"

END=$(date +%s)
DURATION=$((END - START))
STATS+=("$DURATION $TEST")

if [ $EXIT_CODE -eq 0 ]; then
    if [ $WARNING_FOUND -eq 1 ]; then
        WARN_COUNT=$((WARN_COUNT + 1))
        WARNING_TESTS+=("$TEST")
        echo "⚠️  PASS WITH WARNINGS ($DURATION sec)" | tee -a "$LOG_FILE"
    else
        PASS_COUNT=$((PASS_COUNT + 1))
        PASSED_TESTS+=("$TEST")
        echo "✅ PASS ($DURATION sec)" | tee -a "$LOG_FILE"
    fi
else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_TESTS+=("$TEST")
    echo "❌ FAIL ($DURATION sec)" | tee -a "$LOG_FILE"
fi

if [ "$SLEEP_SECONDS" -gt 0 ]; then
    echo "Sleeping $SLEEP_SECONDS seconds..." | tee -a "$LOG_FILE"
    sleep $SLEEP_SECONDS
fi

done

TOTAL_END=$(date +%s)
TOTAL_RUNTIME=$((TOTAL_END - TOTAL_START))

echo "" | tee -a "$LOG_FILE"
echo "======================================================" | tee -a "$LOG_FILE"
echo "FINAL SUMMARY" | tee -a "$LOG_FILE"
echo "======================================================" | tee -a "$LOG_FILE"

echo "Passed Suites: $PASS_COUNT" | tee -a "$LOG_FILE"
echo "Warning Suites: $WARN_COUNT" | tee -a "$LOG_FILE"
echo "Failed Suites: $FAIL_COUNT" | tee -a "$LOG_FILE"
echo "Total Runtime: $TOTAL_RUNTIME sec" | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "Slowest Suites:" | tee -a "$LOG_FILE"
# Sort by duration descending, take top 3
IFS=$'\n' sorted_stats=($(sort -rn <<<"${STATS[*]}"))
unset IFS
for i in "${!sorted_stats[@]}"; do
  if [ $i -lt 3 ]; then
    echo " $((i+1)). $(echo ${sorted_stats[$i]} | awk '{print $2}') ($(echo ${sorted_stats[$i]} | awk '{print $1}') sec)" | tee -a "$LOG_FILE"
  fi
done

echo "" | tee -a "$LOG_FILE"
echo "PASSED:" | tee -a "$LOG_FILE"
for TEST in "${PASSED_TESTS[@]}"
do
echo " ✅ $TEST" | tee -a "$LOG_FILE"
done

if [ ${#WARNING_TESTS[@]} -gt 0 ]; then
    echo "" | tee -a "$LOG_FILE"
    echo "PASSED WITH WARNINGS:" | tee -a "$LOG_FILE"
    for TEST in "${WARNING_TESTS[@]}"
    do
    echo " ⚠️  $TEST" | tee -a "$LOG_FILE"
    done
fi

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
    echo "" | tee -a "$LOG_FILE"
    echo "FAILED:" | tee -a "$LOG_FILE"
    for TEST in "${FAILED_TESTS[@]}"
    do
    echo " ❌ $TEST" | tee -a "$LOG_FILE"
    done
fi

echo "" | tee -a "$LOG_FILE"
echo "Log File:"
echo "$LOG_FILE" | tee -a "$LOG_FILE"

if [ $FAIL_COUNT -gt 0 ]; then
exit 1
else
exit 0
fi
