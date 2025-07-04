import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuthMutation } from "@/hooks/use-auth-mutation";
import { useUser } from "@/hooks/use-jwt";
import { generateStream } from "@/lib/chat/generate-stream";
import { useChatbox } from "@/stores/chatbox";
import { useModel } from "@/stores/model";
import { useModals } from "@/stores/use-modals";
import { useConvex, useConvexMutation } from "@convex-dev/react-query";
import { ArrowUp } from "lucide-react";
import { nanoid } from "nanoid";
import { useNavigate, useParams } from "react-router";
import { ModelSwitcher } from "./models/model-switcher";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { captureChatGenerate } from "@/lib/analytics";

export function ChatInput() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const convex = useConvex();

  const { realUser, isRealLoading } = useUser();
  const setAuthModal = useModals((s) => s.setAuth);

  const addMessageMutation = useAuthMutation({
    mutationFn: useConvexMutation(
      api.messages.addMessagesToThread
    ).withOptimisticUpdate((localStore, args) => {
      if (!realUser) return;
      const existingThreadMessages = localStore.getQuery(
        api.messages.getThreadMessages,
        {
          threadId: args.threadId,
        }
      );

      // Idk whenever i update the localStore with
      // more than 1 item inside the array, the items are added
      // really slowly
      //
      // example: [{ user, "hello"}, { assistant, ""}]
      // THe above messages would be rendered 1 by 1 with
      // a 200-300 ms delay between them. IDK what it is but
      // using a set timeout with >= 0 fixes it ?????????????
      setTimeout(() => {
        localStore.setQuery(
          api.messages.getThreadMessages,
          {
            threadId: args.threadId,
          },
          [
            ...(existingThreadMessages ?? []),
            ...args.messages.map((msg) => ({
              _id: crypto.randomUUID() as Id<"messages">,
              _creationTime: Date.now(),
              threadId: args.threadId,
              ...msg,
            })),
          ]
        );
      }, 0);
    }),
  });

  const onSubmit = async () => {
    // we save re renders this way
    const { prompt, setPrompt } = useChatbox.getState();
    const model = useModel.getState().model;
    if (!prompt) return;
    if (!realUser) {
      setAuthModal(true);
      return;
    }

    const threadIdToUse = threadId || nanoid();
    if (!threadId) {
      navigate(`/${threadIdToUse}`);
    }

    const prevString = prompt;

    try {
      setPrompt("");

      const assistantMsgId = nanoid();
      const userMessage = {
        id: nanoid(),
        content: prompt,
        role: "user" as const,
        status: "done" as const,
        model,
      };

      const isNewThread = threadId !== threadIdToUse;
      captureChatGenerate({
        threadId: threadIdToUse,
        model,
      });

      const chatHistory = isNewThread
        ? []
        : await convex.query(api.messages.getThreadMessages, {
            threadId: threadIdToUse,
          });

      await addMessageMutation.mutateAsync({
        threadId: threadIdToUse,
        messages: [
          userMessage,
          {
            id: assistantMsgId,
            content: "",
            role: "assistant",
            model,
            status: "waiting",
          },
        ],
      });

      const historyToSend = chatHistory.map(({ content, role, id }) => ({
        id,
        content,
        role,
      }));
      historyToSend.push(userMessage);

      generateStream({
        messages: historyToSend,
        messageId: assistantMsgId,
        threadId: threadIdToUse,
      });
    } catch (e) {
      console.log("add:message error", e);
      setPrompt(prevString);
    }
  };

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col text-center">
      <div className="pointer-events-auto bg-secondary/[0.2] p-2 pb-0 backdrop-blur-lg rounded-t-xl">
        <div className="bg-background/[0.5] flex flex-col gap-2 p-2 rounded-t-xl border border-b-0 border-white/5">
          <div className="flex flex-grow flex-row items-start max-h-[500px]">
            <InputBox onSubmit={onSubmit} />
          </div>

          <div className="flex items-center justify-between w-full">
            <ModelSwitcher />
            <SendButton
              disabled={addMessageMutation.isPending || isRealLoading}
              onClick={onSubmit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function InputBox({ onSubmit }: { onSubmit: () => unknown }) {
  const { prompt, setPrompt, inputRef } = useChatbox();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Textarea
      value={prompt}
      onChange={(e) => setPrompt(e.target.value)}
      onKeyDown={handleKeyDown}
      maxRows={9}
      ref={inputRef}
      placeholder="Type your message here."
      className="resize-none border-none rounded-b-none focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent"
    />
  );
}

function SendButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => unknown;
}) {
  const prompt = useChatbox((s) => s.prompt);
  const isDisabled = !prompt.trim() || disabled;

  return (
    <Button
      className="ml-auto"
      size="icon"
      type="submit"
      disabled={isDisabled}
      onClick={onClick}
    >
      <ArrowUp />
    </Button>
  );
}
