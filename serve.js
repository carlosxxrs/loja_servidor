const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();

const TOKEN_PRODUCAO = 'APP_USR-2780487327467860-082116-4bc513a906dc8ce37f12340a5edf9b4d-1391151900';

const client = new MercadoPagoConfig({ 
    accessToken: TOKEN_PRODUCAO 
});
const payment = new Payment(client);

// --- BANCO DE DADOS SQLITE ---
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('>>> NOVO BANCO DE DADOS SQLITE CRIADO E CONECTADO!');
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        passwordHash TEXT,
        isAdmin INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        preco TEXT,
        cor TEXT,
        imagem TEXT,
        destaque TEXT,
        especificacoes TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT UNIQUE,
        usuario TEXT,
        itens TEXT,
        valor TEXT,
        status TEXT,
        data_compra DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS carrinhos (
        usuario TEXT PRIMARY KEY,
        itens TEXT
    )`);

    const hashSenhaAdmin = bcrypt.hashSync("123456", 10);
    db.run(`INSERT OR IGNORE INTO usuarios (username, passwordHash, isAdmin) VALUES (?, ?, 1)`, ["Admin", hashSenhaAdmin]);

    db.get(`SELECT COUNT(*) as qtd FROM produtos`, (err, row) => {
        if (!err && row.qtd === 0) {
            db.run(`INSERT INTO produtos (nome, preco, cor, imagem, destaque, especificacoes) VALUES (?, ?, ?, ?, ?, ?)`, [
                'VIP SUPREMO',
                '45,00',
                '#8c52ff',
                'https://i.imgur.com/vHqQJ4E.png',
                'MAIS VENDIDO',
                JSON.stringify(['Tag [SUPREMO] exclusiva no Chat e Tab', 'Acesso ao /fly no lobby', '5x Caixas Misteriosas'])
            ]);
        }
    });
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
    secret: 'minha_chave_secreta_loja_mc',
    resave: false,
    saveUninitialized: true
}));

app.get('/limpar-compras', (req, res) => {
    db.run(`DELETE FROM compras`, (err) => {
        if (err) return res.send("Erro: " + err.message);
        res.send("<h1>Histórico de compras limpo com sucesso!</h1><a href='/loja'>Voltar para a Loja</a>");
    });
});

// --- ROTAS DE AUTENTICAÇÃO ---

app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/loja');
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.send("Preencha todos os campos! <a href='/login'>Voltar</a>");

    const passwordHash = bcrypt.hashSync(password, 10);

    db.run(`INSERT INTO usuarios (username, passwordHash, isAdmin) VALUES (?, ?, 0)`, [username, passwordHash], function(err) {
        if (err) {
            return res.send("Este Nick já está cadastrado! <a href='/login'>Tentar Login</a>");
        }
        req.session.user = username;
        req.session.isAdmin = false;
        res.redirect('/loja');
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM usuarios WHERE LOWER(username) = LOWER(?)`, [username], (err, userFound) => {
        if (err || !userFound) {
            return res.status(400).json({ error: "Usuário ou senha incorretos." });
        }

        const senhaCorreta = bcrypt.compareSync(password, userFound.passwordHash);

        if (senhaCorreta) {
            req.session.user = userFound.username;
            req.session.isAdmin = Boolean(userFound.isAdmin);
            const redirectUrl = userFound.isAdmin ? '/admin' : '/loja';
            return res.json({ success: true, redirect: redirectUrl });
        } else {
            return res.status(400).json({ error: "Usuário ou senha incorretos." });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).send("Erro ao encerrar a sessão.");
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

app.get('/loja', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'views', 'loja.html'));
});

app.get('/admin', (req, res) => {
    if (!req.session.user || !req.session.isAdmin) {
        return res.send("Acesso negado! <a href='/loja'>Voltar para a Loja</a>");
    }
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// --- API DE PRODUTOS ---

app.get('/api/produtos', (req, res) => {
    db.all(`SELECT * FROM produtos ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: "Erro ao carregar produtos." });
        
        const produtosFormatados = (rows || []).map(p => ({
            ...p,
            especificacoes: JSON.parse(p.especificacoes || '[]')
        }));

        res.json({ user: req.session.user, isAdmin: req.session.isAdmin, produtos: produtosFormatados });
    });
});

app.post('/admin/novo-produto', (req, res) => {
    if (!req.session.user || !req.session.isAdmin) return res.status(403).send("Não autorizado");

    const { nome, preco, cor, imagem, destaque, especificacoes } = req.body;
    const specsArray = especificacoes ? especificacoes.split(',').map(s => s.trim()) : [];

    db.run(`INSERT INTO produtos (nome, preco, cor, imagem, destaque, especificacoes) VALUES (?, ?, ?, ?, ?, ?)`,
        [nome, preco, cor || '#8c52ff', imagem || 'https://i.imgur.com/vHqQJ4E.png', destaque || 'NOVO', JSON.stringify(specsArray)],
        function(err) {
            if (err) console.error("Erro ao inserir produto:", err);
            res.redirect('/loja');
        }
    );
});

app.post('/admin/deletar-produto/:id', (req, res) => {
    if (!req.session.user || !req.session.isAdmin) return res.status(403).json({ success: false, message: "Não autorizado" });

    const idProduto = parseInt(req.params.id);
    
    db.run(`DELETE FROM produtos WHERE id = ?`, [idProduto], function(err) {
        if (err) return res.status(500).json({ success: false });

        db.all(`SELECT usuario, itens FROM carrinhos`, [], (err, rows) => {
            if (!err && rows) {
                rows.forEach(row => {
                    try {
                        let itens = JSON.parse(row.itens || '[]');
                        let novosItens = itens.filter(i => (i.produto ? i.produto.id : i.id) !== idProduto);
                        db.run(`UPDATE carrinhos SET itens = ? WHERE usuario = ?`, [JSON.stringify(novosItens), row.usuario]);
                    } catch (e) {}
                });
            }
        });

        res.json({ success: true, message: "Produto excluído com sucesso!" });
    });
});

// --- CARRINHO BASEADO EM SESSÃO ---

app.get('/api/carrinho', (req, res) => {
    const usuario = req.session.user;
    if (!usuario) return res.json({ success: false, carrinho: [] });

    db.get(`SELECT itens FROM carrinhos WHERE LOWER(usuario) = LOWER(?)`, [usuario], (err, row) => {
        if (err || !row) {
            return res.json({ success: true, carrinho: [] });
        }
        try {
            const carrinhoSalvo = JSON.parse(row.itens || '[]');
            res.json({ success: true, carrinho: carrinhoSalvo });
        } catch (e) {
            res.json({ success: true, carrinho: [] });
        }
    });
});

app.post('/api/carrinho/salvar', (req, res) => {
    const usuario = req.session.user;
    const carrinho = req.body.carrinho || [];

    if (!usuario) return res.status(400).json({ success: false, error: "Usuário não identificado" });

    const itensJson = JSON.stringify(carrinho);

    db.run(`INSERT INTO carrinhos (usuario, itens) VALUES (?, ?) 
            ON CONFLICT(usuario) DO UPDATE SET itens = excluded.itens`, 
    [usuario, itensJson], (err) => {
        if (err) {
            console.error("Erro ao salvar carrinho:", err.message);
            return res.status(500).json({ success: false });
        }
        res.json({ success: true });
    });
});

// --- ROTA DE MINHAS COMPRAS ---
app.get('/api/minhas-compras', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: "Não autorizado" });
    }

    db.all(`SELECT id, payment_id, itens, valor, status, data_compra FROM compras WHERE LOWER(usuario) = LOWER(?) AND status = 'approved' ORDER BY id DESC`, 
    [req.session.user], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: "Erro ao buscar histórico." });
        }

        const comprasFormatadas = (rows || []).map(r => {
            let parsedItens = [];
            try {
                parsedItens = typeof r.itens === 'string' ? JSON.parse(r.itens) : r.itens;
            } catch (e) {
                parsedItens = [];
            }

            let dataFormatada = 'Data indisponível';
            if (r.data_compra) {
                const dataObj = new Date(r.data_compra.includes('Z') ? r.data_compra : r.data_compra.replace(' ', 'T') + 'Z');
                if (!isNaN(dataObj.getTime())) {
                    dataFormatada = dataObj.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + 
                                    ' às ' + 
                                    dataObj.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
                } else {
                    dataFormatada = r.data_compra;
                }
            }

            return {
                id: r.id,
                payment_id: r.payment_id,
                valor: r.valor,
                status: 'approved',
                data_criacao: dataFormatada,
                itens: parsedItens
            };
        });

        res.json({ success: true, compras: comprasFormatadas });
    });
});

// --- CHECKOUT PIX ---
app.post('/api/checkout/pix', async (req, res) => {
    try {
        const { itens } = req.body;
        const usuario = req.session.user;

        if (!itens || itens.length === 0) return res.json({ success: false, error: 'O carrinho está vazio.' });

        const idsNoCarrinho = itens.map(i => i.produto ? i.produto.id : i.id).filter(Boolean);

        db.all(`SELECT id FROM produtos WHERE id IN (${idsNoCarrinho.map(() => '?').join(',')})`, idsNoCarrinho, async (err, rows) => {
            if (err) return res.json({ success: false, error: "Erro ao validar os produtos no carrinho." });

            const idsExistentes = (rows || []).map(r => r.id);
            const produtoFoiDeletado = idsNoCarrinho.some(id => !idsExistentes.includes(id));

            if (produtoFoiDeletado) {
                return res.json({ 
                    success: false, 
                    error: "Um ou mais produtos do seu carrinho foram removidos da loja. O seu carrinho foi limpo." 
                });
            }

            let total = 0;
            itens.forEach(item => {
                const preco = parseFloat(item.produto.preco.replace(',', '.'));
                total += preco * item.quantidade;
            });

            const result = await payment.create({
                body: {
                    transaction_amount: Number(total.toFixed(2)),
                    description: `Minecraft VIP - Jogador: ${usuario || 'Anonimo'}`,
                    payment_method_id: 'pix',
                    payer: {
                        email: 'cliente@email.com',
                        first_name: usuario || 'Jogador',
                        identification: { type: 'CPF', number: '19119119100' }
                    }
                }
            });

            if (result && result.point_of_interaction) {
                const paymentId = String(result.id);
                const qrCodePix = result.point_of_interaction.transaction_data.qr_code;
                const qrCodeBase64 = result.point_of_interaction.transaction_data.qr_code_base64;
                const valorFormatado = total.toFixed(2).replace('.', ',');

                return res.json({
                    success: true,
                    paymentId: paymentId,
                    pixCopiaECola: qrCodePix,
                    qrCodeImg: `data:image/png;base64,${qrCodeBase64}`,
                    valor: valorFormatado
                });
            } else {
                return res.json({ success: false, error: "Retorno inválido do Mercado Pago." });
            }
        });

    } catch (error) {
        console.error("ERRO MERCADO PAGO:", error);
        return res.json({ success: false, error: error.message || "Erro ao gerar PIX." });
    }
});

// --- STATUS CHECK ---
app.post('/api/checkout/status/:id', async (req, res) => {
    try {
        const paymentId = req.params.id;
        const { itens } = req.body;
        const usuario = req.session.user;

        const paymentData = await payment.get({ id: paymentId });
        
        if (paymentData && paymentData.status) {
            const status = paymentData.status;

            if (status === 'approved') {
                db.get(`SELECT id FROM compras WHERE payment_id = ?`, [paymentId], (err, row) => {
                    if (!row) {
                        const itensSimplificados = (itens || []).map(i => ({ 
                            nome: i.produto ? i.produto.nome : (i.nome || 'Produto'), 
                            quantidade: i.quantidade || 1, 
                            preco: i.produto ? i.produto.preco : (i.preco || '0,00'),
                            imagem: i.produto ? i.produto.imagem : (i.imagem || '') 
                        }));

                        const agoraISO = new Date().toISOString();

                        db.run(`INSERT INTO compras (payment_id, usuario, itens, valor, status, data_compra) VALUES (?, ?, ?, ?, ?, ?)`,
                            [paymentId, usuario, JSON.stringify(itensSimplificados), (paymentData.transaction_amount || 0).toFixed(2).replace('.', ','), 'approved', agoraISO]
                        );

                        db.run(`DELETE FROM carrinhos WHERE LOWER(usuario) = LOWER(?)`, [usuario]);
                    }
                });
                return res.json({ success: true, status: 'approved' });
            }

            return res.json({ success: true, status: status });
        }

        return res.json({ success: false, status: 'pending' });
    } catch (error) {
        return res.json({ success: false, status: 'pending' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`>>> SERVIDOR RODANDO EM http://localhost:${PORT}`);
});
