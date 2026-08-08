const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 他のサイト（OneCompilerなど）から接続できるようにする設定
const io = new Server(server, {
  cors: { origin: "*" }
});

// 接続中の全プレイヤーのデータを記憶する場所（キー: socket.id）
let players = {};

io.on('connection', (socket) => {
  console.log('ユーザーが接続しました。 ID:', socket.id);

  // 1. プレイヤーが移動したとき（クライアントは "updatePos" で送信してくる）
  //    まだ登録されていなければ、ここで新規プレイヤーとして登録する
  socket.on('updatePos', (posData) => {
    if (!players[socket.id]) {
      const query = socket.handshake.query || {};
      players[socket.id] = {
        socketId: socket.id,
        playerId: String(query.id || socket.id), // GASのA列と一致させる永続ID
        name: query.name || "ゲスト",
        x: Number(posData.x) || 0,
        y: Number(posData.y) || 0,
        hp: 100,
        radius: 20,
        reach: 60
      };
    } else {
      players[socket.id].x = Number(posData.x) || players[socket.id].x;
      players[socket.id].y = Number(posData.y) || players[socket.id].y;
    }
  });

  // 2. 攻撃ボタンが押されたとき（クライアントは "playerAttackTrigger" で送信してくる）
  socket.on('playerAttackTrigger', (data) => {
    const attacker = players[socket.id];
    if (!attacker || attacker.hp <= 0) return;

    const reach = Number(data && data.reach) || attacker.reach;

    Object.keys(players).forEach((targetSocketId) => {
      if (targetSocketId === socket.id) return; // 自分は除外

      const target = players[targetSocketId];
      if (!target || target.hp <= 0) return; // 既に倒れている相手は除外

      const dx = target.x - attacker.x;
      const dy = target.y - attacker.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // 攻撃リーチの内側に入っている場合
      if (distance <= reach) {
        target.hp = Math.max(0, target.hp - 10);

        // マイクラ風ノックバック
        const angle = Math.atan2(dy, dx);
        const kbForce = 35;
        target.x += Math.cos(angle) * kbForce;
        target.y += Math.sin(angle) * kbForce;

        // やられた本人へ：ノックバック方向を通知（クライアントは "receive_damage" を待っている）
        io.to(targetSocketId).emit('receive_damage', {
          attackerAngle: angle
        });

        // 体力が0（死亡）になったら
        if (target.hp <= 0) {
          // やられた本人へ：ロビーに戻るよう通知（クライアントは "youKilled" を待っている）
          io.to(targetSocketId).emit('youKilled');

          // 倒した本人へ：クライアント側からGASにKP精算リクエストを送らせる
          // （クライアントは "peerKilledConfirmed" を待っている）
          io.to(socket.id).emit('peerKilledConfirmed', {
            loserId: target.playerId,
            loserName: target.name
          });
        }
      }
    });
  });

  // 3. フィールドから離脱したとき（クライアントは "leaveField" で送信してくる）
  socket.on('leaveField', () => {
    delete players[socket.id];
  });

  // 4. 画面を閉じた（切断した）とき
  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました。 ID:', socket.id);
    delete players[socket.id];
  });
});

// 全プレイヤーの位置・HPを100msごとに全員へ配信する
// （クライアントは配列形式の "playerPositions" を待っている）
setInterval(() => {
  const list = Object.values(players).map(p => ({
    id: p.playerId,
    name: p.name,
    x: p.x,
    y: p.y,
    hp: p.hp
  }));
  io.emit('playerPositions', list);
}, 100);

// ポート3000番でサーバー起動
server.listen(3000, () => {
  console.log('=== オンラインゲームサーバーが起動しました！ ===');
});
