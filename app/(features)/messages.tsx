import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, MessageCircle, Send } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "expo-router/react-navigation";

import { getManager, initializeAccountManager } from "@/services/shared";
import { Attachment } from "@/services/shared/attachment";
import { Chat, Message } from "@/services/shared/chat";
import { getAttachmentIcon } from "@/utils/news/getAttachmentIcon";
import { Papicons } from "@getpapillon/papicons";
import Icon from "@/ui/components/Icon";
import Typography from "@/ui/new/Typography";
import { SafeAreaView } from "react-native-safe-area-context";

const plainText = (value: string) =>
  value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const formatDate = (value: Date) =>
  Number.isNaN(value.getTime())
    ? ""
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function MessagesScreen() {
  const { colors } = useTheme();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadChats = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");

    try {
      const manager = getManager(true) ?? await initializeAccountManager();
      const result = await manager.getChats();
      setChats([...result].sort((a, b) => b.date.getTime() - a.date.getTime()));
    } catch {
      setErrorMessage("La messagerie n’a pas pu être chargée. Vérifie la connexion de ton compte scolaire.");
      setChats([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  const openChat = useCallback(async (chat: Chat) => {
    setSelectedChat(chat);
    setMessages([]);
    setLoadingMessages(true);
    setErrorMessage("");
    try {
      const manager = getManager(true) ?? await initializeAccountManager();
      const result = await manager.getChatMessages(chat);
      setMessages([...result].sort((a, b) => a.date.getTime() - b.date.getTime()));
    } catch {
      setErrorMessage("Les messages de cette conversation n’ont pas pu être chargés.");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const content = draft.trim();
    if (!content || !selectedChat || sending) return;
    setSending(true);
    setErrorMessage("");
    try {
      const manager = getManager(true) ?? await initializeAccountManager();
      await manager.sendMessageInChat(selectedChat, content);
      setDraft("");
      const updated = await manager.getChatMessages(selectedChat);
      setMessages([...updated].sort((a, b) => a.date.getTime() - b.date.getTime()));
    } catch {
      setErrorMessage("Le message n’a pas pu être envoyé. Réessaie dans quelques instants.");
    } finally {
      setSending(false);
    }
  }, [draft, selectedChat, sending]);

  const openAttachment = useCallback((attachment: Attachment) => {
    if (!attachment.url) return;
    void WebBrowser.openBrowserAsync(attachment.url, { presentationStyle: "formSheet" });
  }, []);

  const chatKey = useCallback((chat: Chat) => `${chat.createdByAccount}:${chat.id}:${chat.date.getTime()}`, []);
  const sortedMessages = messages;

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.overground }}>
      {selectedChat ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Retour aux conversations" onPress={() => setSelectedChat(null)} hitSlop={12}>
              <ChevronLeft size={24} color={colors.text} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Typography variant="title" numberOfLines={1}>{selectedChat.subject || "Conversation"}</Typography>
              <Typography variant="body2" color="textSecondary" numberOfLines={1}>
                {selectedChat.recipient || selectedChat.creator || formatDate(selectedChat.date)}
              </Typography>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
            {loadingMessages ? (
              <ActivityIndicator color={colors.primary} />
            ) : sortedMessages.length === 0 ? (
              <Typography variant="body1" color="textSecondary" align="center">
                Aucun message dans cette conversation.
              </Typography>
            ) : sortedMessages.map(message => (
              <View key={message.id} style={{ padding: 14, gap: 8, borderRadius: 16, backgroundColor: colors.card }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Typography variant="body1" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{message.author}</Typography>
                  <Typography variant="caption" color="textSecondary">{formatDate(message.date)}</Typography>
                </View>
                <Typography variant="body1">{plainText(message.content)}</Typography>
                {(message.attachments ?? []).map((attachment, index) => (
                  <Pressable
                    key={`${attachment.url}-${index}`}
                    accessibilityRole="link"
                    onPress={() => openAttachment(attachment)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, backgroundColor: colors.background }}
                  >
                    <Icon><Papicons name={getAttachmentIcon(attachment)} /></Icon>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body1" weight="semibold" numberOfLines={1}>{attachment.name || "Pièce jointe"}</Typography>
                      <Typography variant="caption" color="textSecondary" numberOfLines={1}>{attachment.url}</Typography>
                    </View>
                  </Pressable>
                ))}
              </View>
            ))}
            {errorMessage ? <Typography variant="body2" color="#D60046">{errorMessage}</Typography> : null}
          </ScrollView>

          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Écrire un message"
              placeholderTextColor={colors.text + "80"}
              multiline
              editable={!sending}
              style={{ flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, color: colors.text, backgroundColor: colors.card, fontSize: 16 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Envoyer le message"
              disabled={!draft.trim() || sending}
              onPress={() => void sendMessage()}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, opacity: !draft.trim() || sending ? 0.5 : 1 }}
            >
              {sending ? <ActivityIndicator color={colors.background} /> : <Send size={18} color={colors.background} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={chatKey}
          contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadChats(true)} />}
          ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} /> : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
              <MessageCircle size={34} color={colors.text + "80"} />
              <Typography variant="title" align="center">Aucune conversation</Typography>
              <Typography variant="body1" color="textSecondary" align="center">
                {errorMessage || "Les conversations disponibles avec ton compte scolaire apparaîtront ici."}
              </Typography>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void openChat(item)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.card }}
            >
              <MessageCircle size={24} color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Typography variant="title" numberOfLines={1}>{item.subject || "Conversation"}</Typography>
                <Typography variant="body2" color="textSecondary" numberOfLines={1}>
                  {item.recipient || item.creator || "Messagerie scolaire"}
                </Typography>
              </View>
              <Typography variant="caption" color="textSecondary">{formatDate(item.date)}</Typography>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
