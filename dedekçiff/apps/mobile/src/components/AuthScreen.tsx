import { MaterialCommunityIcons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { colors } from "../theme/colors";

const authSchema = z.object({
  email: z.string().email("Geçerli bir e-posta gir."),
  password: z.string().min(8, "Parola en az 8 karakter olmalı.")
});

type AuthForm = z.infer<typeof authSchema>;

export function AuthScreen({ client }: { client: SupabaseClient }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const form = useForm<AuthForm>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "" }
  });

  const submit = form.handleSubmit(async ({ email, password }) => {
    setBusy(true);
    setMessage(undefined);
    const result = isSignUp
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (result.error) {
      setMessage(result.error.message);
    } else if (isSignUp && !result.data.session) {
      setMessage("Hesap oluşturuldu. Devam etmek için e-postanı doğrula.");
    }
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.heading}>
          <MaterialCommunityIcons name="folder-lock" color={colors.accent} size={30} />
          <View>
            <Text style={styles.eyebrow}>GÜVENLİ OTURUM</Text>
            <Text style={styles.title}>Dedektif hesabı</Text>
          </View>
        </View>

        <View style={styles.mode}>
          <Pressable accessibilityRole="button" onPress={() => { setIsSignUp(false); setMessage(undefined); }} style={[styles.modeButton, !isSignUp && styles.modeSelected]}>
            <Text style={styles.modeText}>Giriş yap</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setIsSignUp(true); setMessage(undefined); }} style={[styles.modeButton, isSignUp && styles.modeSelected]}>
            <Text style={styles.modeText}>Hesap oluştur</Text>
          </Pressable>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>E-posta</Text>
          <Controller
            control={form.control}
            name="email"
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="dedektif@ornek.com"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={value}
              />
            )}
          />
          {form.formState.errors.email ? <Text style={styles.error}>{form.formState.errors.email.message}</Text> : null}

          <Text style={styles.label}>Parola</Text>
          <Controller
            control={form.control}
            name="password"
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                autoCapitalize="none"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="En az 8 karakter"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.input}
                value={value}
              />
            )}
          />
          {form.formState.errors.password ? <Text style={styles.error}>{form.formState.errors.password.message}</Text> : null}

          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={[styles.submit, busy && styles.disabled]}>
            <MaterialCommunityIcons name={isSignUp ? "account-plus" : "login"} color={colors.background} size={19} />
            <Text style={styles.submitText}>{busy ? "Bekle..." : isSignUp ? "Hesap oluştur" : "Dosyaya gir"}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  content: { flex: 1, gap: 24, justifyContent: "center", padding: 24 },
  heading: { alignItems: "center", flexDirection: "row", gap: 14 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  title: { color: colors.text, fontSize: 25, fontWeight: "800", marginTop: 3 },
  mode: { borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: "row", gap: 16 },
  modeButton: { borderBottomColor: "transparent", borderBottomWidth: 2, paddingBottom: 11, paddingHorizontal: 2 },
  modeSelected: { borderBottomColor: colors.accent },
  modeText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  form: { gap: 9 },
  label: { color: colors.muted, fontSize: 13, fontWeight: "600", marginTop: 6 },
  input: { backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.text, minHeight: 48, paddingHorizontal: 12 },
  error: { color: colors.danger, fontSize: 12 },
  message: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 5 },
  submit: { alignItems: "center", backgroundColor: colors.accent, borderRadius: 8, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 12, minHeight: 48 },
  disabled: { opacity: 0.6 },
  submitText: { color: colors.background, fontSize: 14, fontWeight: "800" }
});