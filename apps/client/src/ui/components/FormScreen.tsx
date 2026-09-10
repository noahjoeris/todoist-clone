import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

interface FormScreenProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** Centered single-column layout shared by the auth and account screens. */
export function FormScreen({ title, description, children }: FormScreenProps) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>TODOIST CLONE</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {description && <Text style={styles.description}>{description}</Text>}
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Inline, announced error message for forms. */
export function FormError({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 72,
    paddingBottom: 64,
    gap: 12,
  },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  body: { gap: 16, marginTop: 12 },
  error: { color: colors.error, fontSize: 14 },
});
