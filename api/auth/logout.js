// BreedIQ Auth - Logout
export default async function handler(req, res) {
    res.setHeader('Set-Cookie', 'breediq_token=; Path=/; HttpOnly; Max-Age=0; Secure');
    return res.status(200).json({ success: true });
}
