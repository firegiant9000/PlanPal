/**
 * CreateEventForm — M3 event creation flow.
 *
 * Fields:
 *   - Title (required)
 *   - Date / start time / end time
 *   - Repeat settings: None | Daily | Weekly | Bi-weekly | Monthly | Custom RRULE
 *     → Variable-schedule toggle (shows "Schedule not yet entered" placeholder)
 *   - End repeat: Never | On date | After N occurrences
 *   - Notification lead times (checkboxes: 0 min, 10 min, 30 min, 1 hr, 1 day)
 *   - Visibility: Private | Shared with all friends | Sensitive public
 *
 * This component is intentionally self-contained (no API calls inside).
 * The parent screen calls onSubmit with the assembled payload and handles the
 * POST /events call. Local state validates required fields before enabling submit.
 */
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '@planpal/ui';
import { today } from '@planpal/calendar-core';
// RRULE construction lives beside the parser (T28, AD-3) — web's event form
// consumes the same function, so the two platforms cannot build divergent rules.
import { buildRRule } from '@planpal/recurrence';

export type Visibility = 'private' | 'shared_all' | 'shared_select' | 'sensitive_public';

export interface CreateEventPayload {
  title: string;
  description: string;
  localStart: string; // YYYY-MM-DDTHH:mm:ss
  localEnd: string;
  timezoneId: string;
  recurrenceRule: string | null;
  isVariableSchedule: boolean;
  visibility: Visibility;
  notificationLeadTimes: number[]; // minutes
}

interface CreateEventFormProps {
  initialDate?: string;
  timezoneId: string;
  onSubmit: (payload: CreateEventPayload) => void;
  onCancel: () => void;
  submitting?: boolean;
}

type RepeatOption = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'variable';
type EndRepeatOption = 'never' | 'ondate' | 'aftercount';

const REPEAT_LABELS: Record<RepeatOption, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
  variable: 'Variable schedule',
};

const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: 'Private',
  shared_all: 'All friends',
  shared_select: 'Select friends',
  sensitive_public: 'Busy (time only)',
};

const LEAD_TIME_OPTIONS = [
  { label: 'At start', minutes: 0 },
  { label: '10 min before', minutes: 10 },
  { label: '30 min before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '1 day before', minutes: 1440 },
];


export function CreateEventForm({
  initialDate = today(),
  timezoneId,
  onSubmit,
  onCancel,
  submitting = false,
}: CreateEventFormProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [description, setDescription] = useState('');
  const [repeat, setRepeat] = useState<RepeatOption>('none');
  const [endRepeat, setEndRepeat] = useState<EndRepeatOption>('never');
  const [endDate, setEndDate] = useState('');
  const [count, setCount] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [leadTimes, setLeadTimes] = useState<number[]>([10]);
  const [showRepeatPicker, setShowRepeatPicker] = useState(false);
  const [showVisibilityPicker, setShowVisibilityPicker] = useState(false);

  const toggleLeadTime = useCallback((minutes: number) => {
    setLeadTimes((prev) =>
      prev.includes(minutes) ? prev.filter((m) => m !== minutes) : [...prev, minutes],
    );
  }, []);

  const canSubmit = title.trim().length > 0 && date && startTime && endTime && !submitting;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const payload: CreateEventPayload = {
      title: title.trim(),
      description: description.trim(),
      localStart: `${date}T${startTime}:00`,
      localEnd: `${date}T${endTime}:00`,
      timezoneId,
      recurrenceRule: buildRRule({ repeat, endRepeat, endDate, count }),
      isVariableSchedule: repeat === 'variable',
      visibility,
      notificationLeadTimes: leadTimes,
    };
    onSubmit(payload);
  }, [
    canSubmit,
    title,
    description,
    date,
    startTime,
    endTime,
    timezoneId,
    repeat,
    endRepeat,
    endDate,
    count,
    visibility,
    leadTimes,
    onSubmit,
  ]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.root}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Nav bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            onPress={onCancel}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.navCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>New Event</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={[styles.navAdd, !canSubmit && styles.navAddDisabled]}>
              {submitting ? 'Adding…' : 'Add'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Title */}
        <Section label="Title">
          <TextInput
            style={styles.titleInput}
            placeholder="Event title"
            placeholderTextColor={theme.colors.textSecondary}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            returnKeyType="done"
            autoFocus
          />
        </Section>

        {/* Date & Time */}
        <Section label="Date & Time">
          <FormRow label="Date">
            <TextInput
              style={styles.inlineInput}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.colors.textSecondary}
              maxLength={10}
            />
          </FormRow>
          <FormRow label="Start">
            <TextInput
              style={styles.inlineInput}
              value={startTime}
              onChangeText={setStartTime}
              placeholder="HH:MM"
              placeholderTextColor={theme.colors.textSecondary}
              maxLength={5}
            />
          </FormRow>
          <FormRow label="End">
            <TextInput
              style={styles.inlineInput}
              value={endTime}
              onChangeText={setEndTime}
              placeholder="HH:MM"
              placeholderTextColor={theme.colors.textSecondary}
              maxLength={5}
            />
          </FormRow>
        </Section>

        {/* Repeat */}
        <Section label="Repeat">
          <TouchableOpacity
            style={styles.pickerRow}
            onPress={() => setShowRepeatPicker(!showRepeatPicker)}
          >
            <Text style={styles.pickerValue}>{REPEAT_LABELS[repeat]}</Text>
            <Text style={styles.chevron}>{showRepeatPicker ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showRepeatPicker && (
            <View style={styles.pickerOptions}>
              {(Object.keys(REPEAT_LABELS) as RepeatOption[]).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.optionRow, opt === repeat && styles.optionRowSelected]}
                  onPress={() => {
                    setRepeat(opt);
                    setShowRepeatPicker(false);
                  }}
                >
                  <Text style={[styles.optionText, opt === repeat && styles.optionTextSelected]}>
                    {REPEAT_LABELS[opt]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {repeat === 'variable' && (
            <View style={styles.variableNote}>
              <Text style={styles.variableNoteText}>
                Variable schedule — specific times are entered week by week. The event will show
                "Schedule not yet entered" until times are added.
              </Text>
            </View>
          )}

          {repeat !== 'none' && repeat !== 'variable' && (
            <>
              <Text style={styles.subLabel}>End repeat</Text>
              {(['never', 'ondate', 'aftercount'] as EndRepeatOption[]).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={styles.radioRow}
                  onPress={() => setEndRepeat(opt)}
                >
                  <View style={[styles.radio, endRepeat === opt && styles.radioSelected]} />
                  <Text style={styles.radioLabel}>
                    {opt === 'never' ? 'Never' : opt === 'ondate' ? 'On date' : 'After'}
                  </Text>
                  {opt === 'ondate' && endRepeat === 'ondate' && (
                    <TextInput
                      style={styles.inlineInputSmall}
                      value={endDate}
                      onChangeText={setEndDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={theme.colors.textSecondary}
                      maxLength={10}
                    />
                  )}
                  {opt === 'aftercount' && endRepeat === 'aftercount' && (
                    <TextInput
                      style={styles.inlineInputSmall}
                      value={count}
                      onChangeText={setCount}
                      placeholder="N times"
                      placeholderTextColor={theme.colors.textSecondary}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </>
          )}
        </Section>

        {/* Notifications */}
        <Section label="Notifications">
          {LEAD_TIME_OPTIONS.map(({ label, minutes }) => (
            <FormRow key={minutes} label={label}>
              <Switch
                value={leadTimes.includes(minutes)}
                onValueChange={() => toggleLeadTime(minutes)}
                trackColor={{ true: theme.colors.accent }}
              />
            </FormRow>
          ))}
        </Section>

        {/* Visibility */}
        <Section label="Visibility">
          <TouchableOpacity
            style={styles.pickerRow}
            onPress={() => setShowVisibilityPicker(!showVisibilityPicker)}
          >
            <Text style={styles.pickerValue}>{VISIBILITY_LABELS[visibility]}</Text>
            <Text style={styles.chevron}>{showVisibilityPicker ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showVisibilityPicker && (
            <View style={styles.pickerOptions}>
              {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.optionRow, opt === visibility && styles.optionRowSelected]}
                  onPress={() => {
                    setVisibility(opt);
                    setShowVisibilityPicker(false);
                  }}
                >
                  <Text
                    style={[styles.optionText, opt === visibility && styles.optionTextSelected]}
                  >
                    {VISIBILITY_LABELS[opt]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Section>

        {/* Notes */}
        <Section label="Notes">
          <TextInput
            style={styles.notesInput}
            placeholder="Add notes…"
            placeholderTextColor={theme.colors.textSecondary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            maxLength={2000}
            textAlignVertical="top"
          />
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.formRow}>
      <Text style={styles.formRowLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bgMuted,
  },
  scroll: {
    paddingBottom: 40,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  navCancel: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.accent,
  },
  navTitle: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  navAdd: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.accent,
  },
  navAddDisabled: {
    color: theme.colors.textSecondary,
  },
  section: {
    marginTop: theme.spacing.lg,
  },
  sectionLabel: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textSecondary,
    letterSpacing: 0.8,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.xs,
  },
  sectionBody: {
    backgroundColor: theme.colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  titleInput: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.lg,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  formRowLabel: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textPrimary,
  },
  inlineInput: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.accent,
    textAlign: 'right',
  },
  inlineInputSmall: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.accent,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    marginLeft: theme.spacing.sm,
    minWidth: 100,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  pickerValue: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textPrimary,
  },
  chevron: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  pickerOptions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  optionRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  optionRowSelected: {
    backgroundColor: theme.colors.bgMuted,
  },
  optionText: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textPrimary,
  },
  optionTextSelected: {
    color: theme.colors.accent,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  variableNote: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.bgMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  variableNoteText: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  subLabel: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  radioSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  radioLabel: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textPrimary,
    flex: 1,
  },
  notesInput: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    minHeight: 100,
  },
});
