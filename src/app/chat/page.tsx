import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ChatPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Card>
        <CardHeader><CardTitle className="text-sm">💬 猎头翻译官</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">对话模块开发中——先使用旧版 Vercel 部署的聊天功能。</p>
        </CardContent>
      </Card>
    </div>
  );
}
