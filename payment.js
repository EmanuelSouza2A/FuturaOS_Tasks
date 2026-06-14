// 1. O seu site abre um ouvido para escutar o Render em tempo real (SSE)
const eventSource = new EventSource('https://api-futuraos.onrender.com/api/pix/stream');

eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    if(data.status === 'paid') {
        // O Render avisou o seu site que o pagamento caiu!
        atualizarBarraDeProgresso(data.amount);
    }
};

// 2. Quando o usuário clica no botão, o seu site avisa o Render para criar o Pix
async function gerarPix() {
    const response = await fetch('https://api-futuraos.onrender.com/api/pix/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 20 }) // Exemplo de R$ 20
    });
    const data = await response.json();
    
    // Mostra o QR Code que o Render devolveu na tela do usuário
    document.getElementById('qrImage').src = `data:image/png;base64,${data.qrCodeBase64}`;
}
