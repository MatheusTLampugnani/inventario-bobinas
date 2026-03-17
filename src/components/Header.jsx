import logoVideplast from '../assets/videplast-brand.png'

const Header = () => {
  return (
    <header className="app-header text-center">
      <img 
        src={logoVideplast} 
        alt="Videplast" 
        className="logo" 
      />
    </header>
  )
}

export default Header